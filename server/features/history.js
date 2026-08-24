// 加载
await History.load({ path: "/path/to/history.json" })

// 用户发消息
await History.add({
    sessionId: "session-1",
    message: Message.user({ content: "帮我写个爬虫" }),
})

// 模型回复
const assistantResult = await History.add({
    sessionId: "session-1",
    message: Message.assistant({ content: null, toolCalls: [] }),
})

// 工具结果
await History.add({
    sessionId: "session-1",
    message: Message.tool({ toolCallId: "call-1", content: "成功" }),
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

// 获取标准 messages 发给 API
const messages = await History.getMessages({ sessionId: "session-1" })

// 保存
await History.save({ path: "/path/to/history.json" })