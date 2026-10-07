/*
 * 会话历史：加载、追加、回退、恢复和保存一个会话的消息。
 *
 * 每条消息都带一个 messageId，前端用它定位消息和发起回退。
 * 调用示例：
 *   await History.load({ sessionId: 'session-1' })                                  // 从磁盘读进内存
 *   const record = await History.add({ sessionId: 'session-1', message })           // 追加一条消息
 *   const messages = History.get({ sessionId: 'session-1' })                        // 取当前完整历史
 *   await History.rollback({ sessionId: 'session-1', messageId: record.messageId }) // 回退到这条消息之前
 *   await History.save({ sessionId: 'session-1' })                                  // 写回磁盘
 */

import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeFile } from 'atomically'
import { nanoid } from 'nanoid'
import Path from '../utils/path.js' // 生成会话历史文件路径。
import SSE from '../utils/sse.js' // 历史稳定后清掉已经被它包含的流式事件。
import fail from '../utils/fail.js' // 回退到不存在的消息时按填错处理。
import Store from '../store.js' // 直接访问全部会话历史数据。

// --- 加载历史 ---
const load = async ({ sessionId }) => {
    const file = Bun.file(Path.history(sessionId))

    // 历史文件第一次还不存在是正常情况，直接从空历史开始。
    if (!await file.exists()) {
        Store.sessions.set(sessionId, { messages: [], redo: [] })
        return
    }
    Store.sessions.set(sessionId, await file.json())
}

// --- 追加消息 ---
const add = async ({ sessionId, message }) => {
    const session = Store.sessions.get(sessionId) || { messages: [], redo: [] } // 没加载过时先建空历史，避免调用方必须先 load。
    Store.sessions.set(sessionId, session)
    const record = { messageId: nanoid(), message }

    session.messages.push(record) // 消息按发生顺序追加，循环本身从不修改历史。
    session.redo = [] // 新消息代表新的时间线，之前被回退的内容不能再恢复。
    return record
}

// --- 回退消息 ---
const rollback = async ({ sessionId, messageId }) => {
    const session = Store.sessions.get(sessionId)
    const index = session.messages.findIndex(record => record.messageId === messageId)
    // 用户可能拿着旧界面上的消息回退，找不到时按"要回退的消息不存在"反馈。
    if (index < 0) throw fail(404, `Message not found: ${messageId}`)

    // 从目标消息开始的整段内容都移到 redo；当前历史只保留目标消息之前的内容。
    session.redo.push(session.messages.splice(index))
}

// --- 恢复回退内容 ---
const redo = async ({ sessionId }) => {
    const session = Store.sessions.get(sessionId)
    const records = session.redo.pop()

    // 没有可恢复的内容时什么也不做，调用方不需要专门判断。
    if (records) session.messages.push(...records)
}

// --- 读取当前历史 ---
const get = ({ sessionId }) => {
    // 返回完整 History：保留 messageId 和消息上的全部字段。
    // 前端直接使用，模型调用前由 Agent Core 自己裁剪上下文。
    return (Store.sessions.get(sessionId)?.messages || []).map(({ messageId, message }) => ({ messageId, ...message }))
}

// --- 保存历史 ---
const save = async ({ sessionId }) => {
    const path = Path.history(sessionId)
    await mkdir(dirname(path), { recursive: true })
    // 原子写入会先写临时文件，再替换正式文件，避免留下半份 JSON。
    await writeFile(path, JSON.stringify(Store.sessions.get(sessionId), null, 2))
    // 历史成为稳定状态后，清掉已经被历史包含的旧 SSE 流。
    await SSE.reset({ id: sessionId })
}

export default { load, add, rollback, redo, get, save }
