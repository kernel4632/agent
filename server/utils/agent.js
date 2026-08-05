/*
Agent 循环引擎：与项目无关的纯函数，实现"请求模型→执行工具→循环控制"完整流程。
所有数据和能力由调用方传入，引擎通过回调通知调用方每一步的结果。
可被任何项目复用——只需要提供 LLM、工具执行函数和回调。

使用示例
await AgentLoop.run({
  messages: session.messages,
  model: 'gpt-4',
  provider: { api: '...', key: '...' },
  systemPrompt: '你是编程助手',
  toolPrompt: '请使用工具',
  tools: { shell: { description: '...', parameters: {...} } },
  signal: controller.signal,
  llm: LLM,
  runTools: (toolCalls) => Tool.run(toolCalls),
  onEvent: (type, data) => {},
  onAssistant: (message) => {},
  onToolResults: (message, results) => {},
  onRetry: ({ attempt, delay, error }) => {},
})
*/
import { Message } from './message.js'                   // 引入消息工厂
import { Retry } from './retry.js'                       // 引入可中断的无限重试
import { errorMessage } from './error.js'                // 引入错误消息提取


// --- 运行 Agent 循环 ---
async function run({
  messages,                                              // 当前会话消息数组（引擎会直接 push）
  model,                                                 // 模型名称
  provider,                                              // { api, key }
  systemPrompt,                                          // 系统提示词
  toolPrompt,                                            // 连续纯文本后的工具提醒
  tools,                                                 // LLM 工具定义对象
  signal,                                                // AbortSignal 停止信号
  llm,                                                   // LLM 请求能力 { chat() }
  runTools,                                              // 工具执行函数 (toolCalls) => { results, shouldStop }
  onEvent,                                               // 模型流式事件回调 (type, data) => void
  onAssistant,                                           // 助手消息生成后回调 (message) => Promise<void>
  onToolResults,                                         // 工具结果生成后回调 (message, results) => Promise<void>
  onRetry,                                               // 重试回调 ({ attempt, delay, error }) => void
}) {
  let nextPrompt = ''                                    // 临时提醒，只参与紧接着的一轮
  let textOnlyCount = 0                                  // 连续纯文本轮次计数

  while (!signal.aborted) {
    const answer = await Retry.run(async () => {
      const input = nextPrompt ? [...messages, { role: 'user', content: nextPrompt }] : messages
      const messageID = Message.id()                     // 每次重试使用独立的流式消息身份

      const result = await llm.chat({
        apiURL: provider.api,
        apiKey: provider.key,
        model,
        systemPrompt,
        messages: input,
        tools,
        signal,
        onEvent(type, data) {
          onEvent?.(type, { messageId: messageID, ...data })
        },
      })
      return { ...result, messageID }
    }, {
      signal,
      onRetry: onRetry ? ({ attempt, delay, error }) => onRetry({ attempt, delay, error: errorMessage(error) }) : undefined,
    })
    nextPrompt = ''

    const assistant = Message.assistant(answer.contentBlocks)
    assistant.id = answer.messageID                      // 使用流式阶段已广播的消息 ID
    messages.push(assistant)
    await onAssistant?.(assistant)                        // 通知调用方：助手消息已生成

    if (answer.toolCalls.length === 0) {
      textOnlyCount += 1
      if (textOnlyCount >= 3) return                     // 连续三次纯文本 → 结束任务
      if (textOnlyCount === 2) nextPrompt = toolPrompt   // 第二次 → 下轮提醒使用工具
      continue
    }

    textOnlyCount = 0                                    // 有工具调用 → 重置计数
    const toolResults = await runTools(answer.toolCalls)  // 并行执行全部工具
    const toolMessage = Message.tool(toolResults.results)
    messages.push(toolMessage)
    await onToolResults?.(toolMessage, toolResults.results) // 通知调用方：工具结果已生成
    if (toolResults.shouldStop) return                   // finish 工具 → 结束任务
  }
}


export const AgentLoop = { run }
