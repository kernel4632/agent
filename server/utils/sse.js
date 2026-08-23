/* 
目标被调用形式（绝对不可修改）：
// 连接
await SSE.connect({ id: sessionId, request })

// 发消息，随便发，不用管连接状态
await SSE.send({ id: sessionId, data: "你好" })
await SSE.send({ id: sessionId, data: "还在吗" })
await SSE.send({ id: sessionId, data: "任务完成了" })

// 断开
await SSE.close({ id: sessionId })
 */