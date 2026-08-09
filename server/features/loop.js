/*
Agent 循环引擎：构建上下文 → 压缩 → 请求模型 → 执行工具（回调）→ 循环控制。
直接访问 store 读取配置，工具执行通过 execute 回调由调用方定制。
调用示例：await Loop.run({ messages, model, signal, execute, onEvent, onReply, onTools, onRetry })。
*/
import { store } from '../store.js'                      // 引入全局配置
import { LLM } from '../utils/llm.js'                    // 引入 LLM 流式请求能力
import { Message } from '../utils/message.js'            // 引入消息构造
import { Retry } from '../utils/retry.js'                // 引入可中断重试
import { Context } from './context.js'                   // 引入上下文构建
import { Summary } from './summary.js'                   // 引入摘要生成


// --- 运行 Agent 循环 ---
async function run({ messages, model, signal, execute, onEvent, onReply, onTools, onRetry }) {
  const { provider, prompts, context } = store.config    // 读取当前配置
  let hint = ''                                          // 临时工具提醒，只参与一轮
  let textCount = 0                                      // 连续纯文本轮次计数

  while (!signal.aborted) {
    let [built, tokens] = Context.build(messages, context)

    if (provider.maxTokens && tokens > provider.maxTokens) { // token 超阈值时压缩
      const summaryMsg = await Summary.generate(built, { url: provider.api, key: provider.key, model })
      if (summaryMsg) {
        messages.push(summaryMsg)
        ;[built, tokens] = Context.build(messages, context)
      }
    }

    const input = hint ? [...built, { role: 'user', content: [{ type: 'text', text: hint }] }] : built

    const answer = await Retry.run(async () => {
      const messageId = Message.id()
      const result = await LLM.chat({
        url: provider.api, key: provider.key, model,
        system: prompts.system,
        messages: input,
        tools: store.tools,
        signal,
        onEvent(type, data) { onEvent?.(type, { messageId, ...data }) },
      })
      return { ...result, messageId }
    }, {
      signal,
      onRetry: onRetry ? ({ attempt, delay, error }) => onRetry({ attempt, delay, error: error?.message ?? String(error) }) : undefined,
    })
    hint = ''

    const assistant = Message.assistant(answer.contentBlocks)
    assistant.id = answer.messageId
    if (answer.usage) assistant.usage = answer.usage      // 保存 token 用量供前端展示
    onReply?.(assistant)

    if (answer.toolCalls.length === 0) {
      messages.push(assistant)                           // 纯文本立即入列
      textCount += 1
      if (textCount >= 3) return                          // 连续三次纯文本 → 退出
      if (textCount === 2) hint = prompts.tool
      continue
    }

    textCount = 0
    const outcomes = await execute(answer.toolCalls)      // 调用方负责审批和执行
    const results = outcomes.map((o) => o.result)
    const shouldStop = outcomes.some((o) => o.stop)

    const toolMessage = Message.tool(results)
    messages.push(assistant, toolMessage)                 // 配对入列
    await onTools?.(toolMessage, results)
    if (shouldStop) return
  }
}


export const Loop = { run }
