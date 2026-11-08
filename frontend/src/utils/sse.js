/*
SSE 读取：把 fetch 响应体里的 text/event-stream 解析成一条条事件。
调用示例：
  await readSSE(response, event => receive(sessionID, event))

解析交给 eventsource-parser（SSE 规范的参考实现）：多行 data 拼接、
BOM、注释行、retry 字段、CRLF 这些细节由它处理，这里只负责
「读流 → 喂给解析器 → 把 JSON 事件交给回调」。
*/
import { createParser } from 'eventsource-parser'

export async function readSSE(response, receiveEvent) {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || `事件订阅失败 (${response.status})`)
  }
  if (!response.body) throw new Error('服务器没有返回事件流')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  // 解析结果先收进队列，读完一个 chunk 再按顺序交给回调：
  // 回调是 async 的，直接在 onEvent 里 await 会让解析和消费互相等待。
  const queue = []
  const parser = createParser({
    onEvent: event => queue.push(event),
    // 半行/脏帧只跳过，不打断整条连接：事件流断一下不该让界面报错。
    onError: () => {},
  })

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (value) parser.feed(decoder.decode(value, { stream: !done }))
      while (queue.length) {
        const event = queue.shift()
        if (!event.data || event.data === '[DONE]') continue
        // 坏帧只跳过这一条，不拖垮整条连接（和旧实现行为一致）
        let payload
        try { payload = JSON.parse(event.data) } catch { continue }
        await receiveEvent({ ...payload, eventID: Number(event.id || 0) })
      }
      if (done) return
    }
  } finally {
    reader.releaseLock()
  }
}
