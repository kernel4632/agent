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
  const { provider, prompts, context } = store.config
  let textCount = 0                                      // 模型连续多少轮只回文字、没调工具

  // === 主循环：一直跑，直到被停止、模型连续3轮没用工具、或工具要求停止 ===
  while (!signal.aborted) {

    // --- 第一步：把历史消息打包成上下文 ---
    let [built, tokens] = Context.build(messages, context)

    // --- 第二步：上下文太长就压缩（生成摘要替代旧消息） ---
    if (provider.maxTokens && tokens > provider.maxTokens) {
      const summaryMsg = await Summary.generate(built, { url: provider.api, key: provider.key, model })
      if (summaryMsg) {
        messages.push(summaryMsg)                         // 摘要作为新消息加进历史
        ;[built, tokens] = Context.build(messages, context) // 重新打包，这次会短很多
      }
    }

    // --- 第三步：如果模型已经连续2轮没用工具，额外加一句提醒 ---
    const input = textCount === 2
      ? [...built, { role: 'user', content: [{ type: 'text', text: prompts.tool }] }]
      : built

    // --- 第四步：调模型，失败会自动重试 ---
    const answer = await Retry.run(async () => {
      const messageId = Message.id()                     // 给这轮回复生成唯一 ID
      const result = await LLM.chat({
        url: provider.api,
        key: provider.key,
        model,
        system: prompts.system,                          // 系统提示词，告诉模型它是谁
        messages: input,                                 // 打包好的上下文
        tools: store.tools,                              // 模型可以调用的工具列表
        signal,                                          // 停止开关
        onEvent(type, data) {                            // 模型每吐一个字都通知外面
          onEvent?.(type, { messageId, ...data })
        },
      })
      return { ...result, messageId }
    }, {
      signal,
      onRetry: onRetry                                   // 重试时通知外面（第几次、等多久、什么错）
        ? ({ attempt, delay, error }) => onRetry({ attempt, delay, error: error?.message ?? String(error) })
        : undefined,
    })

    // --- 第五步：把模型的回复包装成标准消息 ---
    const assistant = Message.assistant(answer.contentBlocks)
    assistant.id = answer.messageId
    if (answer.usage) assistant.usage = answer.usage      // 记录这轮花了多少 token

    onReply?.(assistant)                                  // 通知外面：模型说完了，完整回复在这

    // --- 第六步：判断模型有没有调工具 ---

    if (answer.toolCalls.length === 0) {
      // 模型只回了文字，没调工具
      messages.push(assistant)
      textCount += 1

      if (textCount >= 3) return                          // 连续3轮纯文字，认为任务结束，退出
      continue                                            // 否则继续下一轮
    }

    // --- 第七步：模型调了工具，让外部去执行 ---
    textCount = 0                                         // 用了工具，重置计数

    const outcomes = await execute(answer.toolCalls)       // 外部负责：审批、执行、返回结果
    const results = outcomes.map((o) => o.result)          // 提取每个工具的执行结果
    const shouldStop = outcomes.some((o) => o.stop)        // 任何工具说"该停了"就停

    // --- 第八步：把模型回复和工具结果一起存进历史 ---
    const toolMessage = Message.tool(results)
    messages.push(assistant, toolMessage)                  // 成对入列：助手消息 + 工具结果

    await onTools?.(toolMessage, results)                  // 通知外面：工具跑完了

    if (shouldStop) return                                // 工具说停，就停
  }
  // 走到这里说明 signal 被中止了，静默退出
}


export const Loop = { run }
