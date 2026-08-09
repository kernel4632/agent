/*
上下文构建功能：从完整 messages 拼接出发给模型的消息视图，同时计算总 token 数。
有摘要时拼接：[开头 head 条] + [摘要] + [摘要前 tail 条] + [摘要后全部]。
调用示例：const [built, tokens] = Context.build(messages, { head: 3, tail: 3 })。
*/
import { Token } from '../utils/token.js'                // 引入 token 计算能力


// --- 构建消息视图 ---
function build(messages, { head = 3, tail = 3 } = {}) {
  let cursor = -1                                        // 摘要消息位置
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].summary) { cursor = i; break }       // 从末尾往前找摘要
  }

  const view = cursor === -1
    ? messages                                           // 没有摘要，原样使用
    : [
        ...messages.slice(0, head),                      // 用户最早 N 条（完整需求）
        messages[cursor],                                // 摘要消息
        ...messages.slice(Math.max(head, cursor - tail), cursor), // 摘要前 N 条（衔接上下文）
        ...messages.slice(cursor + 1),                   // 摘要后全部（最近对话）
      ]

  let tokens = 0
  const built = view.map((msg) => {
    let text = ''                                        // 提取消息文本用于 token 计算
    if (typeof msg.content === 'string') text = msg.content
    else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text') text += part.text ?? ''
        else if (part.type === 'tool-call') text += JSON.stringify(part.input ?? '')
        else if (part.type === 'tool-result') text += typeof part.output?.value === 'string' ? part.output.value : JSON.stringify(part.output?.value ?? '')
      }
    }
    tokens += Token.count(text) + 4                      // +4 为消息头开销
    const { summary, usage, ...clean } = msg             // 剥掉非标准字段
    return clean
  })

  return [built, tokens]
}


export const Context = { build }
