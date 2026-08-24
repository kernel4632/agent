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
    content: "工具执行结果",       // 必填，字符串
})

// 4. 创建压缩总结消息块
const compressMessage = Message.compress({
    content: "之前的对话总结...",  // 必填，字符串
})
 */