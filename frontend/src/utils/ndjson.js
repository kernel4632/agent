/*
NDJSON 流读取工具：把后端实时推送的换行分隔 JSON 对象还原为按顺序到达的事件。
后端通过 ReadableStream enqueue(object) 推送原始对象，HTTP 层序列化为 NDJSON 帧。
调用示例：await readNDJSON(response, event => Chat.receive(event))。
*/

// --- 持续解析 NDJSON 响应 ---
export async function readNDJSON(response, receiveEvent) {
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `事件订阅失败: ${response.status}`)
  const reader = response.body.getReader()               // 从 HTTP Response 读取实时字节流
  const decoder = new TextDecoder()                       // 将 UTF-8 字节转换为文本
  let pendingText = ''                                    // 保存跨网络分块的未完成行
  while (true) {
    const { done, value } = await reader.read()            // 等待下一批事件数据
    pendingText += decoder.decode(value, { stream: !done }) // 追加解码字节到缓冲区
    const lines = pendingText.split('\n')                  // 每行是一个完整 JSON 对象
    pendingText = lines.pop() ?? ''                        // 最后一行可能不完整，留给下次
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue                               // 跳过空行
      try {
        const event = JSON.parse(trimmed)                  // 解析单个事件对象
        await receiveEvent(event)                          // 按到达顺序交给事件处理器
      } catch { /* 损坏的 JSON 帧静默跳过 */ }
    }
    if (done) return                                       // Server 关闭响应后结束读取
  }
}
