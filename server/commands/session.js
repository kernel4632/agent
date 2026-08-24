/* 
// 创建会话
await Session.create({
    title: "写爬虫",
})
// result = { sessionId: "session-1" }

// 删除会话
await Session.remove({
    sessionId: "session-1",
})
// 读取会话
await Session.read({
    sessionId: "session-1",
})
// result = {
//     id: "session-1",
//     title: "写爬虫",
//     history: [...]
// }

// 重命名会话
await Session.rename({
    sessionId: "session-1",
    title: "写爬虫脚本",
})

// 回退会话历史
await Session.rollback({
    sessionId: "session-1",
    messageId: "message-2",     // 回退到这条消息之前
})


// 撤销上一次回退
await Session.redo({
    sessionId: "session-1",
})


// 用户主动压缩当前会话
await Session.compact({
    sessionId: "session-1",
    maxTokens: 8000,             // 压缩后的最大上下文长度
})
  */
