/* 
// 启动循环（循环在后台全自动运转，结果通过 SSE 推送）
const result = await Agent.send({
    sessionId: "session-1",        // 会话 ID
    input: "帮我写个爬虫",    // 用户消息
})
// result = { ok: true }

// 停止循环（立即终止）
const result = await Agent.stop({
    sessionId: "session-1",
})
// result = { ok: true }
*/