/*
 * 消息回退：把对话退回某条消息之前，或者撤销上一次回退。
 *
 * 这里只动消息，不碰磁盘上的文件。文件恢复是文件工具的职责，
 * 指令层要连文件一起退时，会先调用文件工具，再调用这里。
 *
 * 调用示例：
 *   await Rollback.messages({ sessionId, messageId })
 *   await Rollback.undo({ sessionId })
 *   const plan = Rollback.preview({ sessionId, messageId })
 */

import Agent from './agent.js'
import History from './history.js'
import fail from '../utils/fail.js'

// --- 回退到这条消息之前 ---
const messages = async ({ sessionId, messageId }) => {
    const session = await History.load(sessionId)
    if (Agent.runtime().get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)

    await History.rollback({ sessionId, messageId })
    await History.save(sessionId)
    const agent = Agent.runtime().get(sessionId)
    if (agent) agent.history = History.get({ sessionId })
    return session
}

// --- 撤销最近一次回退 ---
const undo = async ({ sessionId }) => {
    await History.load(sessionId)
    if (Agent.runtime().get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)

    await History.redo({ sessionId })
    await History.save(sessionId)
    const agent = Agent.runtime().get(sessionId)
    if (agent) agent.history = History.get({ sessionId })
    return History.load(sessionId)
}

// --- 回退之前先算清楚会消失多少条消息 ---
const preview = ({ sessionId, messageId }) => {
    const history = History.get({ sessionId })
    const index = history.findIndex(message => message.messageId === messageId)
    if (index < 0) throw fail(404, `Message not found: ${messageId}`)
    return {
        messages: history.length - index,
        keep: history.slice(0, index).map(message => message.id),
    }
}

export default { messages, undo, preview }
