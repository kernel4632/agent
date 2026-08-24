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
 */