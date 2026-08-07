/*
Agent 循环引擎：实现"构建上下文→压缩→请求模型→审批→执行工具→循环控制"完整流程。
直接访问 store 读取配置，调用方只需传入会话级参数和回调。

使用示例
await Loop.run({
  messages, model, session, signal,
  execute: (toolCalls) => Tool.run(toolCalls),
  onEvent, onReply, onTools, onRetry,
})
*/
import { store } from '../store.js'                      // 引入全局配置（provider / prompts / context）
import { LLM } from '../utils/llm.js'                    // 引入 LLM 流式请求能力
import { Message } from '../utils/message.js'            // 引入消息工厂
import { Retry } from '../utils/retry.js'                // 引入可中断的无限重试
import { errorMessage } from '../utils/error.js'         // 引入错误消息提取
import { Context } from './context.js'                   // 引入上下文构建功能
import { Summary } from './summary.js'                   // 引入摘要生成功能
import { Approval } from './approval.js'                 // 引入工具审批功能
import { result as toolResult } from '../commands/tool.js' // 引入工具结果构造函数


// --- 运行 Agent 循环 ---
async function run({
  messages,                                              // 当前会话消息数组（引擎会直接 push）
  model,                                                 // 模型名称
  session,                                               // 当前会话对象（审批需要 session.approvals）
  signal,                                                // AbortSignal 停止信号
  execute,                                               // 工具执行函数 (toolCalls) => { results, shouldStop }
  onEvent,                                               // 模型流式事件回调 (type, data) => void
  onReply,                                               // 助手消息生成后回调 (message) => Promise<void>
  onTools,                                               // 工具结果生成后回调 (message, results) => Promise<void>
  onRetry,                                               // 重试回调 ({ attempt, delay, error }) => void
}) {
  const { provider, prompts, context } = store.config    // 从 store 读取当前配置
  let hint = ''                                          // 临时提醒，只参与紧接着的一轮
  let textCount = 0                                      // 连续纯文本轮次计数

  while (!signal.aborted) {
    let [built, tokens] = Context.build(messages, context) // 构建发送给模型的消息视图

    if (provider.maxTokens && tokens > provider.maxTokens) { // token 超模型上下文阈值时触发压缩
      const summaryMsg = await Summary.generate(built, { url: provider.api, key: provider.key, model })
      if (summaryMsg) {
        messages.push(summaryMsg)                        // 摘要追加到 messages
        ;[built, tokens] = Context.build(messages, context) // 重新构建视图
      }
    }

    const input = hint ? [...built, { role: 'user', content: [{ type: 'text', text: hint }] }] : built

    const answer = await Retry.run(async () => {
      const messageId = Message.id()                     // 每次重试使用独立的流式消息身份

      const result = await LLM.chat({
        url: provider.api,
        key: provider.key,
        model,
        system: prompts.system,
        messages: input,
        tools: store.tools,
        signal,
        onEvent(type, data) {
          onEvent?.(type, { messageId, ...data })
        },
      })
      return { ...result, messageId }
    }, {
      signal,
      onRetry: onRetry ? ({ attempt, delay, error }) => onRetry({ attempt, delay, error: errorMessage(error) }) : undefined,
    })
    hint = ''

    const assistant = Message.assistant(answer.contentBlocks)
    assistant.id = answer.messageId                       // 使用流式阶段已广播的消息 ID
    if (answer.usage) assistant.usage = answer.usage      // 保存 token 用量供前端展示和下次 build 计算
    await onReply?.(assistant)                            // 通知调用方：助手消息已生成（SSE 实时推送）

    if (answer.toolCalls.length === 0) {
      messages.push(assistant)                           // 纯文本立即入列（已是完整消息）
      textCount += 1
      if (textCount >= 3) return                          // 连续三次纯文本 → 结束任务
      if (textCount === 2) hint = prompts.tool            // 第二次 → 下轮提醒使用工具
      continue
    }

    textCount = 0                                        // 有工具调用 → 重置计数

    const decisions = await Approval.wait(session, answer.toolCalls, signal) // 等待审批结果
    if (signal.aborted) return                           // stop 期间全被拒绝后直接退出

    const approved = decisions.filter((d) => d.approved) // 通过的工具列表
    const rejected = decisions.filter((d) => !d.approved) // 被拒的工具列表

    const rejectedResults = rejected.map((d) => toolResult(d.toolCall, '用户拒绝执行该工具', true)) // 被拒的直接构造错误结果
    let executedResults = { results: [], shouldStop: false }
    if (approved.length > 0) {
      executedResults = await execute(approved.map((d) => d.toolCall)) // 只执行通过审批的工具
    }

    const allResults = [...rejectedResults, ...executedResults.results] // 合并全部结果
    const toolMessage = Message.tool(allResults)
    messages.push(assistant, toolMessage)                 // assistant + tool-result 配对入列
    await onTools?.(toolMessage, allResults)              // 通知调用方：工具结果已生成
    if (executedResults.shouldStop) return                // finish 工具 → 结束任务
  }
}


export const Loop = { run }
