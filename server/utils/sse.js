/*
SSE 工具：封装 Server-Sent Events 帧编码、广播和连接生命周期。
业务代码只调用 SSE.send / SSE.broadcast，不接触协议帧格式。

使用示例
const { stream, response, close } = SSE.connect(onDisconnect)
SSE.send(stream, 'status', { status: 'running' })
SSE.broadcast(clients, 'text-delta', { text: 'hello' })
*/
const encoder = new TextEncoder()                       // 全局共用 UTF-8 编码器
const HEARTBEAT_INTERVAL = 30000                        // 心跳间隔 30 秒


// --- 编码 SSE 帧 ---
function encode(event, data) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}


// --- 编码 SSE 注释 ---
function comment(text) {
  return encoder.encode(`: ${text}\n\n`)
}


// --- 发送事件到单个客户端 ---
function send(client, event, data) {
  client.enqueue(encode(event, data))
}


// --- 广播事件到客户端集合 ---
function broadcast(clients, event, data) {
  const frame = encode(event, data)                     // 一次编码，全部客户端共享
  for (const client of [...clients]) {
    try { client.enqueue(frame) }
    catch { clients.delete(client) }                    // 失效客户端自动移除
  }
}


// --- 创建 SSE 连接 ---
function connect(onDisconnect) {
  let client                                            // ReadableStream 控制器
  let heartbeat                                         // 心跳定时器
  const stream = new ReadableStream({
    start(controller) {
      client = controller
      client.enqueue(comment('connected'))              // 立即刷新网络响应
      heartbeat = setInterval(() => {
        try { client.enqueue(comment('ping')) }
        catch { clearInterval(heartbeat); onDisconnect?.(client) }
      }, HEARTBEAT_INTERVAL)
    },
    cancel() {
      clearInterval(heartbeat)
      onDisconnect?.(client)
    },
  })
  const response = new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  })
  return { client: () => client, response }             // client 通过函数访问，因为 start 是同步但 stream 构造后才可用
}


export const SSE = { encode, comment, send, broadcast, connect }
