/*
LLM 流工具：请求 OpenAI-compatible 模型，并返回完整文本、AI SDK 内容块、工具调用和用量。
本文件只依赖调用参数和模型 SDK，不读取 store、会话或 SSE 客户端。

使用示例
const controller = new AbortController()
const result = await LLM.chat({
  apiURL: provider.api,
  apiKey: provider.key,
  model: session.model,
  systemPrompt: '你是一个编程助手',
  messages: session.messages,
  tools: {
    shell: {
      description: '执行系统命令',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
      },
    },
  },
  signal: controller.signal,
  onEvent(type, data) {
    if (type === 'text-delta') console.log(data.text)
    if (type === 'reasoning-delta') console.log(data.text)
    if (type === 'tool-call') console.log(data.toolCall.toolName, data.toolCall.input)
  },
})

result.content       // 所有 text 块合并后的完整正文
result.contentBlocks // AI SDK 原生 AssistantContent，可直接保存到 assistant message.content
result.toolCalls     // contentBlocks 中需要执行的 ToolCallPart 列表
result.usage         // AI SDK 返回的 token 用量

需要停止时调用 controller.abort()
*/
import { dynamicTool, jsonSchema, streamText } from 'ai' // 引入 AI SDK 流式文本和动态工具能力
import { createOpenAICompatible } from '@ai-sdk/openai-compatible' // 引入 OpenAI-compatible 模型客户端

const defaultTimeoutMS = 120000                          // 单轮模型请求默认最多等待两分钟


// --- 请求一轮 LLM ---
async function chat({ apiURL, apiKey, model, systemPrompt, messages, tools, signal, onEvent }) {
  const configuredTimeout = Number(process.env.AGENT_REQUEST_TIMEOUT_MS ?? defaultTimeoutMS) // 读取可选单轮请求预算
  const timeoutMS = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? Math.floor(configuredTimeout) : defaultTimeoutMS // 非法值回退默认预算
  const timeoutSignal = AbortSignal.timeout(timeoutMS)   // 超时只结束本轮，外层可以决定是否重试
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal // 调用方停止和超时共享底层请求
  const provider = createOpenAICompatible({ name: 'agent', baseURL: apiURL, apiKey }) // 为当前配置创建模型供应商
  const modelTools = Object.fromEntries(Object.entries(tools ?? {}).map(([name, tool]) => [
    name,
    dynamicTool({ description: tool.description, inputSchema: jsonSchema(tool.parameters) }), // 把通用 JSON Schema 转成 SDK 工具
  ]))

  try {
    const stream = streamText({
      model: provider(model),                            // 使用调用方选择的具体模型
      system: systemPrompt,                              // 传入当前系统提示
      messages,                                          // session.messages 本身就是 ModelMessage[]
      tools: modelTools,                                 // 发送当前扫描到的动态工具
      maxRetries: 0,                                     // 项目统一由 Retry 管理重试
      abortSignal: requestSignal,                        // 停止和单轮超时都中断底层请求
      onError: () => {},                                 // 错误由流事件抛给调用方
    })

    for await (const part of stream.fullStream) {
      if (part.type === 'text-delta') onEvent?.('text-delta', { text: part.text }) // 正文事件可由调用方直接转发
      if (part.type === 'reasoning-delta') onEvent?.('reasoning-delta', { text: part.text }) // 推理事件可由调用方直接转发
      if (part.type === 'tool-call') onEvent?.('tool-call', { toolCall: { type: 'tool-call', toolCallId: part.toolCallId, toolName: part.toolName, input: part.input } }) // 工具事件可由调用方直接转发
      if (part.type === 'tool-error' || part.type === 'error') throw part.error // 模型和工具协议错误结束本轮
      if (part.type === 'abort') throw new DOMException('LLM request aborted', 'AbortError') // SDK 中止事件保持标准语义
    }

    requestSignal.throwIfAborted()                       // 供应商未抛中止事件时也不能吞掉停止
    const responseMessages = await stream.responseMessages // 由 AI SDK 生成可直接用于下一轮的消息
    const assistant = responseMessages.findLast((message) => message.role === 'assistant') // 当前单轮只持久化最终助手消息
    const contentBlocks = assistant?.content ?? []       // 直接保留 AI SDK AssistantContent
    const content = typeof contentBlocks === 'string' ? contentBlocks : contentBlocks.filter((part) => part.type === 'text').map((part) => part.text).join('') // 合并完整正文供调用方直接使用
    const toolCalls = Array.isArray(contentBlocks) ? contentBlocks.filter((part) => part.type === 'tool-call') : [] // 同一内容块直接交给工具执行
    return { content, contentBlocks, toolCalls, usage: await stream.usage } // 返回同一响应的四个清楚视图
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('operation aborted', 'AbortError') // 用户停止保持原始中止语义
    if (timeoutSignal.aborted) throw Object.assign(new Error(`model request timed out after ${timeoutMS}ms`), { status: 408 }) // 超时提供可重试状态
    const failure = error instanceof Error ? error : new Error(String(error)) // SDK 抛出值归一为 Error
    failure.status ??= failure.statusCode               // 统一 SDK HTTP 状态字段供 Retry 判断
    failure.code ??= failure.cause?.code                // 统一底层网络错误代码供 Retry 判断
    throw failure
  }
}


export const LLM = { chat }                              // 导出完整单轮模型请求能力
