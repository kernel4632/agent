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

// --- 一次模型回复里的工具调用 id；文件恢复按它判断要一起退掉哪些快照 ---
const toolCallIdsOf = message => (Array.isArray(message.content) ? message.content : [])
    .filter(part => part?.type === 'tool-call')
    .map(part => part.toolCallId)
    .filter(Boolean)

// --- 回退之前先算清楚会消失多少条消息、牵连哪些工具调用 ---
// 不管退哪条消息，它和它之后的全部都会消失；工具结果不算对话消息，但它的快照要跟着退。
const preview = ({ history, sessionId, messageId }) => {
    const messages = history.get({ sessionId })                    // 当前会话的完整消息
    const index = messages.findIndex(message => message.messageId === messageId) // 目标消息在历史里的位置
    if (index < 0) throw fail(404, `Message not found: ${messageId}`)

    const dropped = messages.slice(index)                          // 会消失的全部记录
    return {
        messages: dropped.filter(message => message.role !== 'tool').length, // 会消失的对话消息（工具结果不算）
        toolCalls: dropped.flatMap(toolCallIdsOf),                 // 一起回退的工具调用
        keep: messages.slice(0, index).map(message => message.id), // 文件恢复要保留的范围
    }
}

// --- 正文块 / 工具调用级回退：算清楚要保留的消息和工具调用 ---
// partIndex 是 assistant content 数组里的位置；保留它前面的内容，
// 切掉它和它后面的所有内容，再删掉这条消息之后的所有对话。
// 保留的工具结果按 toolCallId 留下，不能因为整条 tool 消息在后就一起丢。
const cutPlan = ({ history, sessionId, messageId, partIndex }) => {
    const records = history.records({ sessionId })
    const index = records.findIndex(record => record.messageId === messageId)
    if (index < 0) throw fail(404, `Message not found: ${messageId}`)
    const record = records[index]
    const content = record.message.content
    if (record.message.role !== 'assistant' || !Array.isArray(content)) {
        throw fail(400, 'partIndex can only cut an assistant message')
    }
    if (!Number.isInteger(partIndex) || partIndex < 0 || partIndex >= content.length) {
        throw fail(400, 'partIndex is out of range')
    }
    if (content[partIndex].type !== 'text' && content[partIndex].type !== 'tool-call') {
        throw fail(400, 'partIndex must point to a text or tool-call block')
    }

    const toolCalls = part => part?.type === 'tool-call' ? part.toolCallId : ''
    const droppedCalls = new Set(content.slice(partIndex).map(toolCalls).filter(Boolean))
    // 这条消息之后的助手回复也会被删，它们里面的工具调用也要一起回退文件。
    for (const later of records.slice(index + 1)) {
        if (later.message.role !== 'assistant') continue
        for (const part of later.message.content || []) {
            const id = toolCalls(part)
            if (id) droppedCalls.add(id)
        }
    }

    const keepContent = content.slice(0, partIndex)
    const next = []
    const keepMessages = records.slice(0, index).map(item => item.message.id)
    if (keepContent.length) {
        next.push({ ...record, message: { ...record.message, content: keepContent } })
        keepMessages.push(record.message.id)
    }
    // 目标之前的工具结果要留下；目标之后的工具结果按调用 id 精确删除。
    for (const later of records.slice(index + 1)) {
        if (later.message.role !== 'tool') continue
        const parts = (later.message.content || [])
            .filter(part => part?.type !== 'tool-result' || !droppedCalls.has(part.toolCallId))
        if (parts.length) next.push({ ...later, message: { ...later.message, content: parts } })
    }

    return { next, keepMessages, dropToolCalls: [...droppedCalls] }
}

// --- 按正文块/工具调用切口回退对话；文件恢复由指令层先做 ---
const cut = async ({ history, agent, sessionId, messageId, partIndex }) => {
    const session = await history.load(sessionId)
    if (agent.runtime().get(sessionId)?.running) throw fail(409, `Agent is already running: ${sessionId}`)
    const plan = cutPlan({ history, sessionId, messageId, partIndex })
    await history.replaceFrom({ sessionId, messageId, next: plan.next })
    await history.save(sessionId)
    const running = agent.runtime().get(sessionId)
    if (running) running.history = history.get({ sessionId })
    return session
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

export default { messages, cut, cutPlan, undo, preview }
