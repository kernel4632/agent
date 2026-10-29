/*
 * 消息回退：把对话退回某条消息之前，或者撤销上一次回退。
 *
 * 这里只动消息，不碰磁盘上的文件。文件恢复是文件工具的职责，
 * 指令层要连文件一起退时，会先调用文件工具，再调用这里。
 * 历史读写和运行中的 agent 由调用方传进来，本文件不 import 别的 feature。
 *
 * 调用示例：
 *   const plan = Rollback.preview({ history, sessionId, messageId })
 *   await Rollback.messages({ history, agent, sessionId, messageId })
 *   await Rollback.undo({ history, agent, sessionId })
 */

import fail from '../utils/fail.js'

// --- 回退之前先算清楚会消失多少条消息 ---
const preview = ({ history, sessionId, messageId }) => {
    const messages = history.get({ sessionId })                    // 当前会话的完整消息
    const index = messages.findIndex(message => message.messageId === messageId) // 目标消息在历史里的位置
    if (index < 0) throw fail(404, `Message not found: ${messageId}`)
    return {
        messages: messages.length - index,                         // 会一起消失的消息条数
        keep: messages.slice(0, index).map(message => message.id), // 文件恢复要保留的范围
    }
}

// --- 回退到这条消息之前 ---
const messages = async ({ history, agent, sessionId, messageId }) => {
    const session = await history.load(sessionId)
    if (agent.runtime().get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)

    await history.rollback({ sessionId, messageId })
    await history.save(sessionId)
    const running = agent.runtime().get(sessionId)
    if (running) running.history = history.get({ sessionId })      // 空闲 agent 的内存历史跟着回退
    return session
}

// --- 撤销最近一次回退 ---
const undo = async ({ history, agent, sessionId }) => {
    await history.load(sessionId)
    if (agent.runtime().get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)

    await history.redo({ sessionId })
    await history.save(sessionId)
    const running = agent.runtime().get(sessionId)
    if (running) running.history = history.get({ sessionId })
    return history.load(sessionId)
}

export default { messages, undo, preview }
