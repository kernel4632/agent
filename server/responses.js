/*
HTTP 响应适配器：把 Command 结果和模型 Web Stream 转换为稳定的协议响应。
这里不读取或修改业务状态，只处理状态码、JSON 外形和 SSE 响应头。
调用示例：return Responses.command(await Session.remove(id), 404)。
*/


// --- 创建标准 SSE 响应 ---
function sse(stream) {
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',         // 声明浏览器和 TUI 可识别的 SSE 类型
      'cache-control': 'no-cache',                                // 禁止代理缓存模型增量
      connection: 'keep-alive',                                   // 保持连接直到 Agent 循环结束
    },
  })
}


// --- 创建 JSON 错误响应 ---
function error(status, message) {
  return Response.json({ error: message }, { status })            // 所有 HTTP 业务错误使用同一正文结构
}


// --- 将指令结果转换为 HTTP 响应 ---
function command(result, fallbackStatus = 400) {
  if (result.ok) return result                                     // 成功结果保持普通 JSON 响应

  const { status, ...body } = result                              // 状态码只进入 HTTP 元数据
  return Response.json(body, { status: status ?? fallbackStatus }) // 优先使用指令声明的业务状态码
}


export const Responses = { sse, error, command }                  // 暴露无业务状态的协议转换能力
