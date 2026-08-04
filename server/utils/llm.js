/*
LLM 流工具：请求 OpenAI-compatible 模型，处理单轮超时，并返回 AI SDK AssistantContent 和工具调用。
本文件只依赖调用参数和模型 SDK，不读取 store、会话或 SSE 客户端。
调用示例：await LLM.chat({ apiURL, apiKey, model, messages, tools, signal, onEvent })。
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
      if (part.type === 'text-delta') onEvent?.('text-delta', { delta: part.text }) // 实时反馈正文增量
      if (part.type === 'reasoning-delta') onEvent?.('reasoning-delta', { delta: part.text }) // 实时反馈推理增量
      if (part.type === 'tool-call') onEvent?.('tool-call', { type: 'tool-call', toolCallId: part.toolCallId, toolName: part.toolName, input: part.input }) // 反馈完整 AI SDK ToolCallPart
      if (part.type === 'tool-error' || part.type === 'error') throw part.error // 模型和工具协议错误结束本轮
      if (part.type === 'abort') throw new DOMException('LLM request aborted', 'AbortError') // SDK 中止事件保持标准语义
    }

    requestSignal.throwIfAborted()                       // 供应商未抛中止事件时也不能吞掉停止
    const responseMessages = await stream.responseMessages // 由 AI SDK 生成可直接用于下一轮的消息
    const assistant = responseMessages.findLast((message) => message.role === 'assistant') // 当前单轮只持久化最终助手消息
    const content = assistant?.content ?? []             // 直接保留 AI SDK AssistantContent
    const toolCalls = Array.isArray(content) ? content.filter((part) => part.type === 'tool-call') : [] // 同一内容块直接交给工具执行
    return { content, toolCalls, usage: await stream.usage } // 不重建任何消息内容块
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('operation aborted', 'AbortError') // 用户停止保持原始中止语义
    if (timeoutSignal.aborted) throw Object.assign(new Error(`model request timed out after ${timeoutMS}ms`), { status: 408 }) // 超时提供可重试状态
    const failure = error instanceof Error ? error : Object.assign(new Error(String(error)), error) // 任意 SDK 抛出值转成 Error
    if (failure.status === undefined && failure.statusCode !== undefined) failure.status = failure.statusCode // 统一 SDK HTTP 状态字段
    if (failure.code === undefined && failure.cause?.code !== undefined) failure.code = failure.cause.code // 统一底层网络错误代码
    throw failure                                        // 调用方决定最终状态或重试
  }
}


export const LLM = { chat }                              // 导出完整单轮模型请求能力
