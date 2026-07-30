/*
SSE 读取工具：把真实网络字节流还原为按顺序到达的 event/data 对象。
本文件不认识会话或界面，只负责协议解析，因此可被桌面和浏览器模式共同复用。
调用示例：await readSSE(response, event => Chat.receive(event))。
*/

// --- 持续解析 SSE 响应 ---
export async function readSSE(response, receiveEvent) {
  const reader = response.body.getReader()               // 从 HTTP Response 读取实时字节流
  const decoder = new TextDecoder()                       // 将 UTF-8 字节转换为文本
  let pendingText = ''                                    // 保存跨网络分块的未完成事件
  while (true) {
    const { done, value } = await reader.read()            // 等待下一批模型或工具事件
    pendingText += decoder.decode(value, { stream: !done }) // 合并当前网络分块
    const frames = pendingText.split('\n\n')              // 标准 SSE 使用空行结束事件
    pendingText = frames.pop() ?? ''                       // 最后一段留给下一批继续拼接
    for (const frame of frames) {
      const eventName = frame.match(/^event: (.+)$/m)?.[1] // 读取事件类型
      const dataText = frame.match(/^data: (.+)$/m)?.[1]   // 读取单行 JSON 数据
      if (!eventName || !dataText) continue                // 心跳或空帧不修改业务数据
      await receiveEvent({ name: eventName, data: JSON.parse(dataText) }) // 按到达顺序交给对话指令
    }
    if (done) return                                       // Server 关闭响应后结束读取
  }
}
