/*
SSE 读取工具：把真实网络字节流还原为按顺序到达的 event/data 对象。
本文件不认识会话或界面，只负责协议解析，因此可被桌面和浏览器模式共同复用。
调用示例：await readSSE(response, event => Chat.receive(event))。
*/

// --- 持续解析 SSE 响应 ---
export async function readSSE(response, receiveEvent) {
  if (!response.ok) throw new Error((await response.json()).error ?? `事件订阅失败: ${response.status}`) // 订阅失败不能进入无限读取
  const reader = response.body.getReader()               // 从 HTTP Response 读取实时字节流
  const decoder = new TextDecoder()                       // 将 UTF-8 字节转换为文本
  let pendingText = ''                                    // 保存跨网络分块的未完成事件
  while (true) {
    const { done, value } = await reader.read()            // 等待下一批模型或工具事件
    pendingText += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n') // 统一 CRLF 和 LF 网络帧
    const frames = pendingText.split('\n\n')              // 标准 SSE 使用空行结束事件
    pendingText = frames.pop() ?? ''                       // 最后一段留给下一批继续拼接
    for (const frame of frames) {
      const eventID = Number(frame.match(/^id: (.+)$/m)?.[1] ?? 0) // 读取断线恢复使用的递增 ID
      const eventName = frame.match(/^event: (.+)$/m)?.[1] // 读取事件类型
      const dataText = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n') // 支持多行 data
      if (!eventName || !dataText) continue                // 心跳或空帧不修改业务数据
      await receiveEvent({ id: eventID, name: eventName, data: JSON.parse(dataText) }) // 按到达顺序交给对话指令
    }
    if (done) return                                       // Server 关闭响应后结束读取
  }
}
