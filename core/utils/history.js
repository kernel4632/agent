/*
History 只创建“通用历史块”，不保存任何供应商专用字段。
Context.build() 会过滤 id、compact 等内部字段，只取 role 和 content 给 AI SDK。

// 1. 创建用户历史块
const userMessage = History.user({ content: '帮我写个爬虫' })
// 结果：{ id, role: 'user', content: '帮我写个爬虫' }

// 2. 创建 assistant 历史块
const assistantMessage = History.assistant({
    content: '好的',              // 普通文字；也可以传内容块数组
    toolCalls: [{                 // 可选，模型需要调用工具时传入
        id: 'call-1',
        name: 'finish',
        arguments: { result: '完成' }, // 支持对象，也支持 JSON 字符串
    }],
})

// 3. 创建工具结果历史块
const toolMessage = History.tool({
    toolCallId: 'call-1',
    toolName: 'finish',
    content: '工具执行结果',
})

// 4. 创建压缩总结历史块
const compactMessage = History.compact({ content: '之前的对话总结...' })

// 5. 需要完整内容块时，直接传 AI SDK 风格的 content 数组
const detailedMessage = History.assistant({
    content: [
        { type: 'reasoning', text: '我需要先调用工具。' },
        { type: 'text', text: '我先处理一下。' },
    ],
})
*/

import { nanoid } from 'nanoid'

// 统一检查字符串，避免历史里出现空的身份或内容。
const text = (value, name) => {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string`)
    return value
}

// 每个历史块都有自己的 id；调用方传 id 时保留它，方便前端定位和更新消息。
const messageId = id => text(id ?? nanoid(), 'id')

// 字符串是最简单的写法；数组则原样保留 AI SDK 风格的内容块。
const contentParts = (content, name = 'content') => {
    if (Array.isArray(content)) return content
    if (content === null && name === 'assistant content') return []
    return [{ type: 'text', text: text(content, name) }]
}

// 创建用户历史块；Context.build() 最终会只取 role 和 content。
const user = ({ id, content }) => ({ id: messageId(id), role: 'user', content: text(content, 'content') })

// 创建 assistant 历史块；内容块和工具调用最终都放在同一个 content 数组里。
const assistant = ({ id, content = null, toolCalls = [] }) => ({
    id: messageId(id),
    role: 'assistant',
    content: [
        ...contentParts(content, 'assistant content'),
        ...toolCalls.map(({ id: callId, name, arguments: rawArguments, input }) => ({
            type: 'tool-call',
            toolCallId: text(callId, 'toolCalls[].id'),
            toolName: text(name, 'toolCalls[].name'),
            input: input ?? (typeof rawArguments === 'string' ? JSON.parse(text(rawArguments, 'toolCalls[].arguments')) : rawArguments),
        })),
    ],
})

// 创建工具结果历史块；toolCallId 必须和 assistant 的工具调用对应。
const tool = ({ id, toolCallId, toolName, content }) => ({
    id: messageId(id),
    role: 'tool',
    content: [{
        type: 'tool-result',
        toolCallId: text(toolCallId, 'toolCallId'),
        toolName: text(toolName, 'toolName'),
        output: typeof content === 'string' ? { type: 'text', value: text(content, 'content') } : content,
    }],
})

// 创建压缩总结块；它仍然是 user 角色，但 compact 标记让 Context 识别最新总结。
const compact = ({ id, content }) => ({ id: messageId(id), role: 'user', content: text(content, 'content'), compact: true })

export default { user, assistant, tool, compact }
