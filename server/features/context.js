/* 
目标被调用形式（绝对不可修改）：
const { messages, token } = Context.build({
    history: History.getMessages(),
})
*/

import { countTokens } from 'gpt-tokenizer'

// 最前面的消息保留用户最初目标；总结前的消息保留当前任务的最近过程。
const KEEP_FIRST = 3
const KEEP_BEFORE_SUMMARY = 3

const fail = (message, reason) => {
    throw new TypeError(`Invalid ${message.role} message: ${reason}`)
}

const text = (value, message, name) => {
    if (typeof value !== 'string') fail(message, `${name} must be a string`)
    return value
}

const json = (value, message, name) => {
    // 工具参数必须能变成 JSON，AI SDK 才能把它发送给模型提供商。
    try {
        const serialized = JSON.stringify(value)
        if (serialized === undefined) fail(message, `${name} must be JSON serializable`)
        return JSON.parse(serialized)
    } catch {
        fail(message, `${name} must be JSON serializable`)
    }
}

const assistantPart = (part, message) => {
    if (part?.type === 'text') return { type: 'text', text: text(part.text, message, 'text') }
    if (part?.type === 'tool-call') return {
        type: 'tool-call',
        toolCallId: text(part.toolCallId, message, 'toolCallId'),
        toolName: text(part.toolName, message, 'toolName'),
        input: json(part.input, message, 'tool call input'),
    }
    fail(message, `unsupported assistant part: ${part?.type}`)
}

const toolPart = (part, message) => {
    if (part?.type !== 'tool-result') fail(message, `unsupported tool part: ${part?.type}`)
    if (part.output?.type !== 'text') fail(message, 'tool output must be text')

    return {
        type: 'tool-result',
        toolCallId: text(part.toolCallId, message, 'toolCallId'),
        toolName: text(part.toolName, message, 'toolName'),
        output: { type: 'text', value: text(part.output.value, message, 'tool output value') },
    }
}

const forModel = message => {
    // 白名单重建消息：History 的所有自定义字段都会在这里被彻底丢弃。
    if (!message || typeof message !== 'object') throw new TypeError('Invalid message')
    if (message.role === 'system' || message.role === 'user') {
        return { role: message.role, content: text(message.content, message, 'content') }
    }
    if (message.role === 'assistant') {
        if (typeof message.content === 'string') return { role: 'assistant', content: message.content }
        if (!Array.isArray(message.content)) fail(message, 'content must be a string or array')
        return { role: 'assistant', content: message.content.map(part => assistantPart(part, message)) }
    }
    if (message.role === 'tool') {
        if (!Array.isArray(message.content)) fail(message, 'content must be an array')
        return { role: 'tool', content: message.content.map(part => toolPart(part, message)) }
    }
    throw new TypeError(`Invalid message role: ${message.role}`)
}

const build = ({ history }) => {
    // 从后往前找，确保多次压缩后只使用最新总结。
    const summaryIndex = history.findLastIndex(message => message.compress === true)
    let selected

    if (summaryIndex < 0) {
        // 没有压缩总结时，完整历史就是最准确的上下文。
        selected = history
    } else {
        const first = history.slice(0, Math.min(KEEP_FIRST, summaryIndex))

        // 跳过已经放进 first 的消息，避免短历史中出现重复内容。
        const beforeStart = Math.max(first.length, summaryIndex - KEEP_BEFORE_SUMMARY)
        const beforeSummary = history.slice(beforeStart, summaryIndex)
        const summary = history[summaryIndex]
        const afterSummary = history.slice(summaryIndex + 1)

        // 顺序固定：最初目标 → 最新总结 → 总结前现场 → 总结后新消息。
        selected = [...first, summary, ...beforeSummary, ...afterSummary]
    }

    const messages = selected.map(forModel)

    // 消息包含文字、工具调用和工具结果。转成 JSON 文本后统一计数，
    // 不需要为每种消息形状分别编写计算规则。
    const token = countTokens(JSON.stringify(messages))
    return { messages, token }
}

export default { build }
