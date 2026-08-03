/*
Agent 指令集：接收用户消息、执行模型与工具循环，并停止当前会话。
模型上下文只来自 session.messages；工具定义只来自 store.config.tools。
调用示例：await Agent.send(sessionId, '分析项目')、await Agent.stop(sessionId)。
*/
import { createOpenAICompatible } from '@ai-sdk/openai-compatible' // 引入 OpenAI-compatible 模型客户端
import { streamText } from 'ai'                           // 引入模型流式文本和工具调用能力
import { store } from '../store.js'                      // 引入配置和会话运行状态
import { retry } from '../utils/retry.js'                // 引入无限指数退避能力
import { Session } from './session.js'                   // 引入会话读写和 SSE 反馈
import { Tool } from './tool.js'                         // 引入 LLM 工具定义和并行执行

const toolReminder = '继续完成用户任务。需要外部操作时必须调用可用工具，不要只描述计划。' // 第二次纯文本后仅向下一轮模型提示


// --- 发送用户消息 ---
async function send(id, content) {
  const session = await Session.getMutable(id)           // 读取当前会话真实对象
  if (!session) throw businessError(404, 'session not found') // 不向未知会话发送消息
  if (session.status !== 'idle') throw businessError(409, 'session is not idle') // 只有空闲会话可以启动新 Agent 循环
  if (typeof content !== 'string' || !content.trim()) throw businessError(400, 'message content must not be empty') // 空消息不启动模型

  const message = {                                      // 创建严格符合 store 的用户消息
    id: Session.createMessageId(),                        // 生成稳定消息身份
    role: 'user',                                         // 标记用户来源
    content: [{ type: 'text', text: { text: content.trim() } }], // 用户输入保存为文本内容块
  }
  session.messages.push(message)                          // 将消息加入模型上下文
  session.status = 'running'                              // 会话进入执行状态
  session.textOnlyCount = 0                               // 新任务重新统计纯文本轮次
  session.abortController = new AbortController()         // 建立本轮统一停止信号
  await Session.save(id)                                  // 后台执行前先保证用户消息已落盘
  Session.emit(id, 'message', { message: structuredClone(message) }) // 反馈完整用户消息
  Session.emit(id, 'status', { status: session.status })  // 反馈执行状态
  session.abortController.finished = run(id, session.abortController).catch(() => {}) // 控制器同时记录后台循环完成时刻
  return { messageId: message.id }                        // 返回新消息身份
}


// --- 执行 Agent 循环 ---
async function run(id, controller) {
  const session = await Session.getMutable(id)            // 后台任务继续修改同一会话对象
  if (!session) return                                     // 删除先发生时不再启动执行
  let reminder = ''                                        // 默认不向模型增加临时提醒

  try {
    while (!controller.signal.aborted) {
      const turn = await retry(                            // 可恢复上游错误无限重试
        () => requestTurn(session, reminder, controller.signal),
        ({ error, attempt, nextRetryIn }) => Session.emit(id, 'error', { message: error.message, attempt, nextRetryIn }),
        controller.signal,
      )
      reminder = ''                                        // 提醒只参与紧接着的一轮
      session.messages.push(turn.message)                  // 成功完成的助手消息加入持久化上下文
      Session.emit(id, 'message', { message: structuredClone(turn.message) }) // 反馈完整助手消息
      await Session.save(id)                               // 模型流完整结束后保存

      if (turn.toolCalls.length > 0) {
        session.textOnlyCount = 0                          // 工具调用打断连续纯文本计数
        const toolRun = await Tool.runAll(id, turn.toolCalls) // 同轮工具全部并行执行
        controller.signal.throwIfAborted()                 // 停止期间完成的工具结果不再写入会话
        const toolMessage = { id: Session.createMessageId(), role: 'tool', content: toolRun.results } // 工具结果组成独立消息
        session.messages.push(toolMessage)                 // 工具结果加入下一轮上下文
        for (const toolResult of toolRun.results) Session.emit(id, 'tool-result', { messageId: toolMessage.id, toolResult: structuredClone(toolResult) }) // 逐个反馈工具结果
        Session.emit(id, 'message', { message: structuredClone(toolMessage) }) // 反馈完整工具消息
        await Session.save(id)                             // 全部并行工具结束后统一保存
        if (toolRun.shouldStop) break                      // Agent 工具明确完成任务时退出
        continue                                          // 工具结果交给下一轮模型继续处理
      }

      session.textOnlyCount += 1                           // 没有工具调用时累计纯文本轮次
      if (session.textOnlyCount === 2) reminder = toolReminder // 第二次后提醒下一轮调用工具
      if (session.textOnlyCount >= 3) break                // 第三次保留普通回复并结束
    }

    session.status = 'idle'                                // 正常完成或用户停止都恢复空闲
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') session.status = 'idle' // 用户停止不是执行错误
    else {
      session.status = 'error'                             // 不可重试错误保留错误状态
      Session.emit(id, 'error', { message: error.message }) // 反馈最终失败原因
    }
  } finally {
    if (session.abortController === controller) session.abortController = null // 只清理本轮自己的控制器
    session.textOnlyCount = 0                              // 下次发送从零开始统计
    await Session.save(id).catch(() => {})                 // 无论结果如何保存最终状态
    Session.emit(id, 'status', { status: session.status })  // 反馈最终状态
  }
}


// --- 请求一轮模型 ---
async function requestTurn(session, reminder, abortSignal) {
  const provider = store.config.provider                  // 每轮读取最新 API 配置
  if (!provider?.api || !provider?.key) throw businessError(400, 'provider api and key must be configured') // 缺少认证不能请求
  if (!session.model) throw businessError(400, 'session model must be configured') // 会话必须明确模型

  const client = createOpenAICompatible({                 // 根据最小 provider 配置创建模型客户端
    name: session.provider || 'agent',                     // provider 字段作为客户端名称
    apiKey: provider.key,                                  // 使用配置中的原始 Key
    baseURL: provider.api,                                 // 使用配置中的 API 地址
  })
  const messages = toModelMessages(session.messages)       // 把 store 消息转换为 AI SDK 协议
  if (reminder) messages.push({ role: 'user', content: reminder }) // 临时提醒不写入 store
  const result = streamText({                              // 单轮只请求模型，不让 SDK 自动执行多轮
    model: client(session.model),                          // 使用会话选择的模型
    messages,                                             // 发送完整会话上下文
    tools: Tool.forModel(),                               // 工具信息只来自 store.config.tools
    maxRetries: 0,                                        // 关闭 SDK 次数预算，统一交给无限 retry
    abortSignal,                                          // 用户停止可中断网络和流读取
    onError: () => {},                                    // 流错误由下方 fullStream 和 retry 统一处理，不重复打印
  })

  const message = { id: Session.createMessageId(), role: 'assistant', content: [] } // 本轮助手消息先在局部构建
  const textBlocks = new Map()                            // 流 ID 对应当前文本块
  const thinkingBlocks = new Map()                        // 流 ID 对应当前思考块
  for await (const part of result.fullStream) {
    if (part.type === 'text-start') textBlocks.set(part.id, addTextBlock(message)) // 新文本段保持输出顺序
    if (part.type === 'text-delta') {
      const block = textBlocks.get(part.id) ?? addTextBlock(message, textBlocks, part.id) // 兼容未发送 start 的供应商
      block.text.text += part.text                         // 将文本增量写入 store 结构
      Session.emit(session.id, 'text-delta', { messageId: message.id, text: part.text }) // 实时反馈文本
    }
    if (part.type === 'reasoning-start') thinkingBlocks.set(part.id, addThinkingBlock(message)) // 新思考段保持输出顺序
    if (part.type === 'reasoning-delta') {
      const block = thinkingBlocks.get(part.id) ?? addThinkingBlock(message, thinkingBlocks, part.id) // 兼容未发送 start 的供应商
      block.thinking.thinking += part.text                 // 将思考增量写入 store 结构
      Session.emit(session.id, 'thinking-delta', { messageId: message.id, thinking: part.text }) // 实时反馈思考
    }
    if (part.type === 'tool-call') {
      const toolCall = { type: 'tool_call', toolCallId: part.toolCallId, toolName: part.toolName, input: part.input, status: 'pending' } // 保存完整工具调用
      message.content.push(toolCall)                       // 工具调用按模型输出顺序进入消息
      Session.emit(session.id, 'tool-call', { messageId: message.id, toolCall: structuredClone(toolCall) }) // 反馈完整调用
    }
    if (part.type === 'tool-error') throw part.error       // 工具参数解析失败按模型错误处理
    if (part.type === 'error') throw normalizeError(part.error) // 流内错误交给重试判断
    abortSignal.throwIfAborted()                           // 每个流片段后检查用户停止
  }

  const toolCalls = message.content.filter((block) => block.type === 'tool_call') // 收集本轮工具调用供并行执行
  return { message, toolCalls }                           // 返回完整助手消息和工具调用
}


// --- 添加文本块 ---
function addTextBlock(message, blocks, id) {
  const block = { type: 'text', text: { text: '' } }     // 文本块严格符合 store 结构
  message.content.push(block)                             // 保留与思考和工具调用的顺序
  if (blocks && id) blocks.set(id, block)                 // 兼容缺少 start 事件时登记流 ID
  return block                                            // 返回可追加内容的真实对象
}


// --- 添加思考块 ---
function addThinkingBlock(message, blocks, id) {
  const block = { type: 'thinking', thinking: { thinking: '' } } // 思考块严格符合 store 结构
  message.content.push(block)                             // 保留模型原始输出顺序
  if (blocks && id) blocks.set(id, block)                 // 兼容缺少 start 事件时登记流 ID
  return block                                            // 返回可追加思考的真实对象
}


// --- 转换模型上下文 ---
function toModelMessages(messages) {
  return messages.map((message, index) => {
    if (message.role === 'user') return { role: 'user', content: message.content.filter((block) => block.type === 'text').map((block) => ({ type: 'text', text: block.text.text })) } // 用户消息只发送文本块
    if (message.role === 'assistant') return { role: 'assistant', content: message.content.flatMap((block) => {
      if (block.type === 'text') return [{ type: 'text', text: block.text.text }] // 助手文本直接还原
      if (block.type === 'tool_call') return [{ type: 'tool-call', toolCallId: block.toolCallId, toolName: block.toolName, input: block.input }] // 工具调用恢复 SDK 格式
      return []                                           // 思考内容不重新发送给模型
    }) }
    return { role: 'tool', content: message.content.filter((block) => block.type === 'tool_result').map((block) => ({
      type: 'tool-result',
      toolCallId: block.toolCallId,
      toolName: findToolName(messages, index, block.toolCallId), // 从前面的工具调用恢复名称
      output: { type: block.isError ? 'error-text' : 'text', value: stringifyOutput(block.output) }, // 结果转换为 SDK 文本输出
    })) }
  })
}


// --- 查找工具名称 ---
function findToolName(messages, beforeIndex, toolCallId) {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const call = messages[index].content.find((block) => block.type === 'tool_call' && block.toolCallId === toolCallId) // 从最近消息向前匹配调用 ID
    if (call) return call.toolName                        // 找到后返回模型原始工具名
  }
  return 'unknown_tool'                                  // 损坏历史使用稳定占位名
}


// --- 转换工具输出文本 ---
function stringifyOutput(output) {
  return typeof output === 'string' ? output : JSON.stringify(output) // 对象输出使用 JSON 保留结构
}


// --- 统一流错误 ---
function normalizeError(error) {
  return error instanceof Error ? error : new Error(String(error)) // retry 只接收稳定 Error 对象
}


// --- 停止 Agent ---
async function stop(id) {
  const session = await Session.getMutable(id)           // 读取目标会话运行状态
  if (!session) throw businessError(404, 'session not found') // 未知会话不能停止
  const controller = session.abortController             // 保存本轮控制器供等待后台清理
  controller?.abort(new DOMException('stopped by user', 'AbortError')) // 中断模型请求和退避等待
  await Tool.stopAll(id)                                 // 并行终止全部工具进程
  await controller?.finished?.catch(() => {})            // 等待 Agent finally 完成，删除会话时不会被重新写回
  session.abortController = null                         // 清除当前停止控制器
  session.textOnlyCount = 0                              // 下次执行重新计数
  session.status = 'idle'                                // 停止完成后恢复空闲
  await Session.save(id)                                 // 保存最终持久化状态
  Session.emit(id, 'status', { status: session.status }) // 反馈停止结果
  return { status: session.status }                      // 返回当前状态
}


// --- 创建业务错误 ---
function businessError(status, message) {
  return Object.assign(new Error(message), { status })   // 让 server.js 统一转换 HTTP 状态
}


export const Agent = { send, run, stop }                // 导出消息发送、循环和停止动作
