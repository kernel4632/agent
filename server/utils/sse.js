/*
SSE 工具：将业务事件编码为标准 UTF-8 Server-Sent Events 帧。
本文件不读取 Store、不广播事件，只提供可移植的协议格式转换。
调用示例：SSE.encode('finish', { ok: true }, 3)。
*/
const encoder = new TextEncoder() // 复用无状态 UTF-8 编码器


// --- 编码一个 SSE 事件 ---
function encode(name, data, id) {
  const payload = JSON.stringify(data, (_, value) => typeof value === 'bigint' ? Number(value) : value) // BigInt token 转换为 JSON 数值
  const idLine = id === undefined ? '' : `id: ${id}\n` // 内部模型流没有 ID，Session 事件流必须携带 ID
  return encoder.encode(`${idLine}event: ${name}\ndata: ${payload}\n\n`) // 返回网络响应可直接写入的字节
}


export const SSE = { encode } // 暴露唯一协议编码动作
