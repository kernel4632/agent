/*
摘要生成功能：调 LLM 将历史对话压缩为结构化摘要。
返回一条带 summary:true 标记的 assistant 消息，push 进 messages 后下次 build 自动跳过被覆盖的历史。
调用示例：const msg = await Summary.generate(built, { url, key, model })、messages.push(msg)。
*/
import { store } from '../store.js'                      // 引入摘要提示词配置
import { LLM } from '../utils/llm.js'                    // 引入 LLM 流式请求能力
import { Message } from '../utils/message.js'            // 引入消息工厂


// --- 生成摘要 ---
async function generate(built, { url, key, model }) {
  const material = built.slice(3, -3)                    // 去掉头尾各 3 条，压缩中间部分
  if (material.length === 0) return null

  const content = material.map((msg) => {
    const text = Array.isArray(msg.content)
      ? msg.content.map((p) => p.type === 'text' ? p.text : p.type === 'tool-call' ? `[调用 ${p.toolName}]` : p.type === 'tool-result' ? `[结果 ${p.toolName}: ${String(p.output?.value ?? '').slice(0, 200)}]` : '').filter(Boolean).join('\n')
      : String(msg.content ?? '')
    return `[${msg.role}] ${text}`
  }).join('\n\n')

  const result = await LLM.chat({
    url, key, model,
    system: store.config.prompts.summary,                // 使用配置中的摘要提示词
    messages: [{ role: 'user', content: [{ type: 'text', text: content }] }],
    tools: {},
  })

  const summary = Message.assistant([{ type: 'text', text: `[对话历史摘要]\n${result.content}` }])
  summary.summary = true                                 // 标记为摘要，build 时定位用
  if (result.usage) summary.usage = result.usage
  return summary
}


export const Summary = { generate }
