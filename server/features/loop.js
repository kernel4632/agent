/*
Agent 循环引擎：构建上下文 → 压缩 → 请求模型 → 审批 → 执行工具 → 循环控制。
直接访问 store 读取配置，调用方传入会话级参数和回调。
调用示例：await Loop.run({ sessionID, messages, model, signal, onEvent, onReply, onTools, onRetry })。
*/
import { store } from '../store.js'                      // 引入全局配置和运行时数据
import { LLM } from '../utils/llm.js'                    // 引入 LLM 流式请求能力
import { Message } from '../utils/message.js'            // 引入消息和工具结果构造
import { Tool } from '../utils/tool.js'                  // 引入工具执行能力
import { SSE } from '../utils/sse.js'                    // 引入 SSE 广播能力
import { Retry } from '../utils/retry.js'                // 引入可中断重试
import { Context } from './context.js'                   // 引入上下文构建
import { Summary } from './summary.js'                   // 引入摘要生成
import { Approval } from './approval.js'                 // 引入工具审批


// --- 运行 Agent 循环 ---
async function run({ sessionID, messages, model, signal, onEvent, onReply, onTools, onRetry }) {
  const { provider, prompts, context } = store.config    // 读取当前配置
  const runtime = store.runtime[sessionID]               // 读取当前运行时状态
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
    const decisions = await Approval.wait(runtime, answer.toolCalls, signal) // 审批
    if (signal.aborted) return

    const approved = decisions.filter((d) => d.approved)
    const rejected = decisions.filter((d) => !d.approved)
    const rejectedResults = rejected.map((d) => Message.result(d.toolCall, '用户拒绝执行该工具', true))

    let executedResults = []
    let shouldStop = false
    for (const { toolCall } of approved) {               // 逐个执行通过审批的工具
      const execution = Tool.execute(toolCall.toolName, toolCall.input, {
        onOutput: (chunk) => SSE.broadcast(runtime.clients, 'tool-output', { toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, output: chunk }),
      })
      runtime.tools.add(execution)
      const value = await execution.result
      runtime.tools.delete(execution)
      executedResults.push(Message.result(toolCall, value.output, value.isError))
      if (value.stop) shouldStop = true
    }

    const allResults = [...rejectedResults, ...executedResults]
    const toolMessage = Message.tool(allResults)
    messages.push(assistant, toolMessage)                 // 配对入列
    await onTools?.(toolMessage, allResults)
    if (shouldStop) return
  }
}


export const Loop = { run }
