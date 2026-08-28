/* 
创建标准AI SDK消息块专用工具
// 1. 创建用户消息块
const userMessage = Message.user({
    content: "帮我写个爬虫",       // 必填，字符串
})

// 2. 创建 assistant 消息块
const assistantMessage = Message.assistant({
    content: "好的",              // 必填，字符串或 null
    toolCalls: [                 // 可选，模型调了工具才传
        {
            id: "call-1",        // 工具调用 ID
            name: "finish",      // 工具名
            arguments: '{"result":"完成"}',   // JSON 字符串，不是对象
        },
    ],
})

// 3. 创建工具结果消息块
const toolMessage = Message.tool({
    toolCallId: "call-1",        // 必填，对应哪个工具调用
    toolName: "file_write",      // 必填，对应哪个工具
    content: "工具执行结果",       // 必填，字符串
})

// 4. 创建压缩总结消息块
const compactMessage = Message.compact({
    content: "之前的对话总结...",  // 必填，字符串
})
 */

const text = (value, name) => { // 消息工厂统一使用非空字符串，避免产生无效历史记录。
    if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string`)
    return value
}

const user = ({ content }) => ({ // 用户消息已经是 AI SDK 标准格式，可以直接返回。
    role: 'user',
    content: text(content, 'content'),
})

const assistant = ({ content, toolCalls = [] }) => ({ // assistant 消息把文字和工具调用放入同一个 content 数组。
    role: 'assistant',
    content: [
        ...(content === null ? [] : [{ type: 'text', text: text(content, 'content') }]),
        ...toolCalls.map(({ id, name, arguments: rawArguments }) => ({
            type: 'tool-call',
            toolCallId: text(id, 'toolCalls[].id'),
            toolName: text(name, 'toolCalls[].name'),
            input: JSON.parse(text(rawArguments, 'toolCalls[].arguments')),
        })),
    ],
})

const tool = ({ toolCallId, toolName, content }) => ({ // 工具结果必须带上调用 ID 和工具名，模型才能对应结果。
    role: 'tool',
    content: [{
        type: 'tool-result',
        toolCallId: text(toolCallId, 'toolCallId'),
        toolName: text(toolName, 'toolName'),
        output: typeof content === 'string' ? { type: 'text', value: text(content, 'content') } : content,
    }],
})

const compact = ({ content }) => ({ // 压缩消息保留 user 形状，再用 compact 标记给 Context.build 识别。
    role: 'user',
    content: text(content, 'content'),
    compact: true,
})

export default { user, assistant, tool, compact }
