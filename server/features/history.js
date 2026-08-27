/* 
目标被调用形式（绝对不可修改）：
// 加载
await History.load({ path: "/path/to/history.json" })

// 用户发消息
await History.add({
    sessionId: "session-1",
    message: Message.user({ content: "帮我写个爬虫" }),
})

// 模型回复
await History.add({
    sessionId: "session-1",
    message: Message.assistant({ content: null, toolCalls: [] }),
})

// 工具结果
await History.add({
    sessionId: "session-1",
    message: Message.tool({ toolCallId: "call-1", toolName: "file_write", content: "成功" }),
})

// 压缩
await History.add({
    sessionId: "session-1",
    message: Message.compress({ content: "总结..." }),
})

// 回退
await History.rollback({
    sessionId: "session-1",
    messageId: assistantResult.messageId,
})

// 发现回退错了，撤回来
await History.redo({ sessionId })

// 获取当前会话未经筛选的完整 History
const history = History.get({ sessionId: "session-1" })

 // 保存
 await History.save({ path: "/path/to/history.json" })
 */

import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeFile } from 'atomically'
import { nanoid } from 'nanoid'
import Path from '../utils/path.js'
import SSE from '../utils/sse.js'

// 一个 Map 管理全部会话。key 是 sessionId，value 是该会话的消息和回退记录。
let sessions = new Map()

const getSession = sessionId => {
    let session = sessions.get(sessionId)
    if (!session) {
        // 第一次收到这个 sessionId 时，自动创建一份空历史。
        session = { messages: [], redo: [] }
        sessions.set(sessionId, session)
    }
    return session
}

const load = async ({ path, sessionId }) => {
    const sessionPath = !path && sessionId
    path ||= sessionId && Path.history(sessionId)
    if (!path) throw new TypeError('path or sessionId is required')
    const file = Bun.file(path)

    // 历史文件第一次还不存在是正常情况，直接从空历史开始。
    if (!await file.exists()) {
        if (sessionId) sessions.set(sessionId, { messages: [], redo: [] })
        else sessions = new Map()
        return
    }

    const data = await file.json()
    // 会话文件只保存自己的记录；旧的总文件仍可恢复全部会话。
    if (sessionPath) sessions.set(sessionId, data)
    else sessions = new Map(Object.entries(data))
}

const add = async ({ sessionId, message }) => {
    const session = getSession(sessionId)
    const record = { messageId: nanoid(), message }

    session.messages.push(record)
    // 新消息代表新的时间线，之前被回退的内容不能再恢复。
    session.redo = []
    return record
}

const rollback = async ({ sessionId, messageId }) => {
    const session = getSession(sessionId)
    const index = session.messages.findIndex(record => record.messageId === messageId)
    if (index < 0) throw new Error(`Message not found: ${messageId}`)

    // 从目标消息开始的整段内容都移到 redo；当前历史只保留目标消息之前的内容。
    session.redo.push(session.messages.splice(index))
}

const redo = async ({ sessionId }) => {
    const session = getSession(sessionId)
    const records = session.redo.pop()

    // 没有可恢复的内容时什么也不做，调用方不需要专门判断。
    if (records) session.messages.push(...records)
}

const get = ({ sessionId }) => {
    // 返回完整 History：保留 messageId 和消息上的全部字段。
    // 前端直接使用，模型调用前由 Context.build 统一过滤。
    return getSession(sessionId).messages.map(({ messageId, message }) => ({ messageId, ...message }))
}

const save = async ({ path, sessionId }) => {
    const sessionPath = !path && sessionId
    path ||= sessionId && Path.history(sessionId)
    if (!path) throw new TypeError('path or sessionId is required')
    // 会话文件只写当前记录；旧的总文件才写全部 Map。
    const data = JSON.stringify(sessionPath ? getSession(sessionId) : Object.fromEntries(sessions), null, 2)
    await mkdir(dirname(path), { recursive: true })
    // 原子写入会先写临时文件，再替换正式文件，避免留下半份 JSON。
    await writeFile(path, data)
    // 历史成为稳定状态后，清掉已经被历史包含的旧 SSE 流。
    if (sessionPath) await SSE.reset({ id: sessionId })
}

export default { load, add, rollback, redo, get, save }
