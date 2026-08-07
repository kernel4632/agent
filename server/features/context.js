/*
上下文构建功能：从完整 messages 拼接出发给模型的消息视图，同时计算总 token 数。
messages 不被修改，返回的是剥掉非标准字段（summary/usage）的新数组。

使用示例
const [built, tokens] = Context.build(messages)
*/
import { encodingForModel } from 'js-tiktoken'           // 引入 token 估算能力

let encoder = null                                       // 延迟初始化 tiktoken 编码器


// --- 获取编码器 ---
function getEncoder() {
  if (!encoder) encoder = encodingForModel('gpt-4o')     // 通用模型编码器，覆盖绝大多数场景
  return encoder
}


// --- 估算单条消息的 token 数 ---
function estimate(message) {
  const enc = getEncoder()
  let text = ''
  if (typeof message.content === 'string') text = message.content
  else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === 'text') text += part.text ?? ''
      else if (part.type === 'tool-call') text += JSON.stringify(part.input ?? '')
      else if (part.type === 'tool-result') text += typeof part.output?.value === 'string' ? part.output.value : JSON.stringify(part.output?.value ?? '')
    }
  }
  return enc.encode(text).length + 4                     // +4 为消息头开销
}


// --- 构建发送给模型的消息视图 ---
function build(messages, { head = 3, tail = 3 } = {}) {
  let cursor = -1                                        // 摘要消息位置
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].summary) { cursor = i; break }       // 从末尾往前找，几步就到
  }

  let view                                               // 拼接后的消息视图
  if (cursor === -1) {
    view = messages                                      // 没有摘要，原样使用
  } else {
    const headMsgs = messages.slice(0, head)             // 用户最早 N 条（完整需求）
    const summary = messages[cursor]                     // 摘要消息
    const before = messages.slice(Math.max(head, cursor - tail), cursor) // 摘要前 N 条（衔接上下文）
    const after = messages.slice(cursor + 1)             // 摘要后全部（最近对话）
    view = [...headMsgs, summary, ...before, ...after]
  }

  let tokens = 0                                         // 累计 token 数
  const built = view.map((msg) => {
    tokens += estimate(msg)                              // 遍历时顺便累加 token
    const { summary, usage, ...clean } = msg             // 剥掉非标准字段
    return clean
  })

  return [built, tokens]
}


export const Context = { build }
