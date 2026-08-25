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

// 获取标准 messages 发给 API
const messages = await History.getMessages({ sessionId: "session-1" })

 // 保存
 await History.save({ path: "/path/to/history.json" })
 */

import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeFile } from 'atomically'
import { nanoid } from 'nanoid'

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

const load = async ({ path }) => {
    const file = Bun.file(path)

    // 历史文件第一次还不存在是正常情况，直接从空历史开始。
    if (!await file.exists()) {
        sessions = new Map()
        return
    }

    // JSON 只能保存普通对象，读取后再恢复成方便查找的 Map。
    sessions = new Map(Object.entries(await file.json()))
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

const getMessages = async ({ sessionId }) => {
    // messageId 只给 History 的回退功能使用，模型只需要标准消息本身。
    return getSession(sessionId).messages.map(record => record.message)
}

const save = async ({ path }) => {
    // Map 不能直接写成 JSON，先转回普通对象；redo 也保存，重启后仍可撤销回退。
    const data = JSON.stringify(Object.fromEntries(sessions), null, 2)
    await mkdir(dirname(path), { recursive: true })
    // 原子写入会先写临时文件，再替换正式文件，避免留下半份 JSON。
    await writeFile(path, data)
}

export default { load, add, rollback, redo, getMessages, save }
