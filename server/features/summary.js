/*
摘要生成功能：接收 build 后的消息，调 LLM 流式生成结构化摘要。
返回一条合法的 assistant 消息（带 summary: true 标记）。

使用示例
const summaryMsg = await Summary.generate(built, { url, key, model })
messages.push(summaryMsg)
*/
import { LLM } from '../utils/llm.js'                    // 引入流式 LLM 请求能力
import { Message } from '../utils/message.js'            // 引入消息工厂

const SYSTEM = `你是一个上下文压缩助手。将以下对话历史压缩为结构化摘要。
要求：
- 保留：用户的核心需求、关键决策、文件路径、错误及修复、当前进度
- 去掉：冗余描述、重复内容、思考过程、大段代码和文件内容
- 格式：用简短的条目列表，每条一个关键事实
- 语言：与对话相同的语言`


// --- 生成摘要 ---
async function generate(built, { url, key, model }) {
  const material = built.slice(3, -3)                    // 去掉头尾各 3 条，压缩中间部分
  if (material.length === 0) return null                  // 没有可压缩内容时不生成

  const content = material.map((msg) => {                // 把消息转成文本供摘要模型阅读
    const role = msg.role
    const text = Array.isArray(msg.content)
      ? msg.content.map((p) => p.type === 'text' ? p.text : p.type === 'tool-call' ? `[调用工具 ${p.toolName}]` : p.type === 'tool-result' ? `[工具结果 ${p.toolName}: ${String(p.output?.value ?? '').slice(0, 200)}]` : '').filter(Boolean).join('\n')
      : String(msg.content ?? '')
    return `[${role}] ${text}`
  }).join('\n\n')

  const result = await LLM.chat({
    url,
    key,
    model,
    system: SYSTEM,
    messages: [{ role: 'user', content: [{ type: 'text', text: content }] }],
    tools: {},
  })

  const summary = Message.assistant([{ type: 'text', text: `[对话历史摘要]\n${result.content}` }])
  summary.summary = true                                 // 标记为摘要消息，build 时定位用
  if (result.usage) summary.usage = result.usage         // 保存 token 用量
  return summary
}


export const Summary = { generate }
