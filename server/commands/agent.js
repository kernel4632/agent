/*
Agent 指令集：接收用户消息、执行模型与工具循环，并停止当前会话。
模型上下文只来自 session.messages；工具定义只来自启动扫描得到的 store.tools。
调用示例：await Agent.send(sessionId, '分析项目')、await Agent.stop(sessionId)。
*/
import { createOpenAICompatible } from '@ai-sdk/openai-compatible' // 引入 OpenAI-compatible 模型客户端
import { streamText } from 'ai'                           // 引入模型流式文本和工具调用能力
import { store } from '../store.js'                      // 引入配置和会话运行状态
import { retry } from '../utils/retry.js'                // 引入无限指数退避能力
import { Session } from './session.js'                   // 引入会话读写和 SSE 反馈
import { Tool } from './tool.js'                         // 引入 LLM 工具定义和并行执行

const toolReminder = '继续完成用户任务。需要外部操作时必须调用可用工具，不要只描述计划。' // 第二次纯文本后仅向下一轮模型提示
const runCompletions = new WeakMap()                     // 按当前控制器记录后台完成时刻，不修改会话结构


// --- 发送用户消息 ---
async function send(id, content) {
  const session = await Session.getMutable(id)           // 读取当前会话真实对象
  if (!session) throw businessError(404, 'session not found') // 不向未知会话发送消息
  if (session.status !== 'idle' || session.abortController) throw businessError(409, 'session is not idle') // 最终保存结束前不能启动重叠循环
  if (typeof content !== 'string' || !content.trim()) throw businessError(400, 'message content must not be empty') // 空消息不启动模型

  const message = {                                      // 创建严格符合 store 的用户消息
    id: Session.createMessageId(),                        // 生成稳定消息身份
    role: 'user',                                         // 标记用户来源
    content: [{ type: 'text', text: { text: content.trim() } }], // 用户输入保存为文本内容块
  }
  session.messages.push(message)                          // 将消息加入模型上下文
  session.status = 'running'                              // 会话进入执行状态
  session.textOnlyCount = 0                               // 新任务重新统计纯文本轮次
  const controller = new AbortController()                // 建立本轮统一停止信号
  session.abortController = controller                    // 工具和停止指令共享当前信号
  const firstSave = Session.save(id)                     // 后台执行前先保证用户消息已落盘
  const execution = startRun(id, message, controller, firstSave) // 立即登记完整生命周期供停止和删除等待
  try { await firstSave }                                // HTTP 成功只表示用户消息已经持久化
  catch (error) {
    await execution                                      // 等待启动失败清理会话运行状态
    throw error                                          // 将保存错误反馈给 HTTP 调用方
  }
  return { messageId: message.id }                        // 返回新消息身份
}


// --- 记录后台执行 ---
function startRun(id, message, controller, firstSave) {
  const execution = continueAfterSave(id, message, controller, firstSave).catch(() => {}) // 最终错误已经写入会话和 SSE
  runCompletions.set(controller, execution)             // stop 和删除动作可以等待本轮完成
  return execution                                       // send 在启动保存失败时等待清理结束
}


// --- 保存成功后开始执行 ---
async function continueAfterSave(id, message, controller, firstSave) {
  try { await firstSave }                                // 用户消息必须先安全落盘
  catch (error) {
    await recordStartError(id, controller, error)        // 保存失败时恢复可停止的最终状态
    return                                               // 不向模型发送尚未持久化的消息
  }
  Session.emit(id, 'message', { message: structuredClone(message) }) // 落盘后反馈完整用户消息
  Session.emit(id, 'status', { status: 'running' })      // 反馈执行已经开始
  await run(id, controller)                              // 启动模型与工具循环
}


// --- 记录启动错误 ---
async function recordStartError(id, controller, error) {
  const session = await Session.getMutable(id)           // 读取发送动作刚修改的真实会话
  if (!session || session.abortController !== controller) return // 会话删除或新执行接管时不覆盖状态
  session.abortController = null                         // 启动失败后释放本轮停止控制器
  session.textOnlyCount = 0                              // 下次发送重新统计纯文本轮次
  session.status = 'error'                               // 用户消息未落盘时保留明确错误状态
  Session.emit(id, 'error', { message: normalizeError(error).message }) // 反馈启动保存失败原因
  Session.emit(id, 'status', { status: session.status }) // 反馈最终错误状态
}


// --- 执行 Agent 循环 ---
async function run(id, controller) {
  const session = await Session.getMutable(id)            // 后台任务继续修改同一会话对象
  if (!session) return                                     // 删除先发生时不再启动执行

  try {
    await runTurns(id, session, controller.signal)       // 连续执行模型轮次直到完成、停止或失败
    session.status = 'idle'                                // 正常完成或用户停止都恢复空闲
  } catch (error) {
    recordRunError(id, session, controller.signal, error) // 区分用户停止和最终执行错误
  } finally {
    await finishRun(id, session, controller)             // 清理运行字段并反馈最终状态
  }
}


// --- 连续执行模型轮次 ---
async function runTurns(id, session, abortSignal) {
  let reminder = ''                                      // 默认不向模型增加临时提醒
  while (!abortSignal.aborted) {
    const turn = await requestTurnWithRetry(id, session, reminder, abortSignal) // 可恢复上游错误无限重试
    reminder = ''                                        // 提醒只参与紧接着的一轮
    await saveAssistantTurn(id, session, turn.message)   // 完整助手消息进入持久化上下文

    if (turn.toolCalls.length > 0) {
      const shouldStop = await runToolTurn(id, session, turn.toolCalls, abortSignal) // 同轮工具全部并行执行
      if (shouldStop) return                             // finish 工具明确结束当前任务
      continue                                           // 工具结果交给下一轮模型处理
    }

    session.textOnlyCount += 1                           // 没有工具调用时累计纯文本轮次
    if (session.textOnlyCount >= 3) return               // 第三次保留普通回复并结束
    if (session.textOnlyCount === 2) reminder = toolReminder // 第二次后提醒下一轮调用工具
  }
}


// --- 重试一轮模型请求 ---
function requestTurnWithRetry(id, session, reminder, abortSignal) {
  return retry(
    () => requestTurn(session, reminder, abortSignal),   // 每次重试重新创建网络请求和模型流
    ({ error, attempt, nextRetryIn }) => Session.emit(id, 'error', { message: error.message, attempt, nextRetryIn }), // 反馈退避原因和等待时间
    abortSignal,                                         // 用户停止同时中断请求和退避等待
  )
}


// --- 保存助手轮次 ---
async function saveAssistantTurn(id, session, message) {
  session.messages.push(message)                         // 成功完成的助手消息加入模型上下文
  Session.emit(id, 'message', { message: structuredClone(message) }) // 反馈完整助手消息
  await Session.save(id)                                 // 模型流完整结束后统一保存
}


// --- 执行工具轮次 ---
async function runToolTurn(id, session, toolCalls, abortSignal) {
  session.textOnlyCount = 0                              // 工具调用打断连续纯文本计数
  const toolRun = await Tool.runAll(id, toolCalls)       // 同轮工具全部同时开始
  abortSignal.throwIfAborted()                           // 停止期间完成的工具结果不再写入会话
  const message = { id: Session.createMessageId(), role: 'tool', content: toolRun.results } // 结果组成独立工具消息
  session.messages.push(message)                         // 工具结果加入下一轮模型上下文
  for (const toolResult of toolRun.results) Session.emit(id, 'tool-result', { messageId: message.id, toolResult: structuredClone(toolResult) }) // 逐个反馈工具结果
  Session.emit(id, 'message', { message: structuredClone(message) }) // 反馈完整工具消息
  await Session.save(id)                                 // 全部并行工具结束后统一保存
  return toolRun.shouldStop                              // finish 工具决定是否结束任务
}


// --- 记录执行错误 ---
function recordRunError(id, session, abortSignal, error) {
  if (abortSignal.aborted || error?.name === 'AbortError') {
    session.status = 'idle'                              // 用户停止不是执行错误
    return                                               // 停止原因不发送错误事件
  }
  const failure = normalizeError(error)                  // SSE 始终接收稳定错误文本
  session.status = 'error'                               // 不可重试错误保留错误状态
  Session.emit(id, 'error', { message: failure.message }) // 反馈最终失败原因
}


// --- 完成后台执行 ---
async function finishRun(id, session, controller) {
  session.textOnlyCount = 0                              // 下次发送从零开始统计
  try { await Session.save(id) }                         // 最终状态必须真实写入磁盘
  catch (error) {
    session.status = 'error'                             // 保存失败时不能向客户端伪报正常完成
    Session.emit(id, 'error', { message: normalizeError(error).message }) // 反馈最终持久化失败
  }
  if (session.abortController === controller) session.abortController = null // 最终保存完成后再释放本轮控制器
  Session.emit(id, 'status', { status: session.status }) // 反馈最终状态
}


// --- 请求一轮模型 ---
async function requestTurn(session, reminder, abortSignal) {
  const configuredTimeout = Number(process.env.AGENT_REQUEST_TIMEOUT_MS ?? 120000) // 读取可选单次请求预算
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? Math.floor(configuredTimeout) : 120000 // 非法配置回退两分钟
  const timeoutSignal = AbortSignal.timeout(timeoutMs)    // 超时让挂起请求进入无限重试
  const requestSignal = AbortSignal.any([abortSignal, timeoutSignal]) // 用户停止和单次超时任一都中断请求
  const messages = toModelMessages(session.messages)       // 把 store 消息转换为 AI SDK 协议
  if (reminder) messages.push({ role: 'user', content: reminder }) // 临时提醒不写入 store

  try {
    const stream = createModelStream(session, messages, requestSignal) // 使用最新配置发起单轮模型请求
    return await readModelStream(stream, session.id, requestSignal) // 把模型流还原为 store 消息
  } catch (error) {
    if (requestSignal.aborted) throwRequestAbort(abortSignal, timeoutSignal, timeoutMs) // 所有超时路径统一转换为可重试错误
    throw error                                           // 协议和供应商错误交给 retry 分类
  }
}


// --- 创建模型响应流 ---
function createModelStream(session, messages, abortSignal) {
  const provider = store.config.provider                 // 每轮读取最新 API 配置
  if (!provider?.api || !provider?.key) throw businessError(400, 'provider api and key must be configured') // 缺少认证不能请求
  if (!session.model) throw businessError(400, 'session model must be configured') // 会话必须明确模型
  const client = createOpenAICompatible({                // 根据最小 provider 配置创建模型客户端
    name: session.provider || 'agent',                   // provider 字段作为客户端名称
    apiKey: provider.key,                                // 使用配置中的原始 Key
    baseURL: provider.api,                               // 使用配置中的 API 地址
  })
  return streamText({                                    // 单轮只请求模型，不让 SDK 自动执行多轮
    model: client(session.model),                          // 使用会话选择的模型
    messages,                                             // 发送完整会话上下文
    tools: Tool.forModel(),                               // 工具信息只来自启动扫描得到的 store.tools
    maxRetries: 0,                                        // 关闭 SDK 次数预算，统一交给无限 retry
    abortSignal,                                          // 用户停止或单次超时可中断网络和流读取
    onError: () => {},                                    // 流错误由下方 fullStream 和 retry 统一处理，不重复打印
  }).fullStream                                          // 调用方只需要读取完整事件流
}


// --- 读取模型响应流 ---
async function readModelStream(stream, sessionId, abortSignal) {
  const message = { id: Session.createMessageId(), role: 'assistant', content: [] } // 本轮助手消息先在局部构建
  const textBlocks = new Map()                            // 流 ID 对应当前文本块
  const thinkingBlocks = new Map()                        // 流 ID 对应当前思考块
  const state = { sessionId, message, textBlocks, thinkingBlocks } // 流片段共享当前消息构建状态
  for await (const part of stream) {
    applyStreamPart(part, state)                         // 按事件类型修改消息并发送增量反馈
    abortSignal.throwIfAborted()                         // 每个流片段后检查停止或超时
  }
  abortSignal.throwIfAborted()                           // 无 abort 事件的供应商也不能吞掉中断

  const toolCalls = message.content.filter((block) => block.type === 'tool_call') // 收集本轮工具调用供并行执行
  return { message, toolCalls }                          // 返回完整助手消息和工具调用
}


// --- 处理模型流片段 ---
function applyStreamPart(part, state) {
  if (part.type === 'text-start') addTextBlock(state.message, state.textBlocks, part.id) // 新文本段保持输出顺序
  if (part.type === 'text-delta') appendTextDelta(part, state) // 文本增量进入当前文本块
  if (part.type === 'reasoning-start') addThinkingBlock(state.message, state.thinkingBlocks, part.id) // 新思考段保持输出顺序
  if (part.type === 'reasoning-delta') appendThinkingDelta(part, state) // 思考增量进入当前思考块
  if (part.type === 'tool-call') appendToolCall(part, state) // 完整工具调用进入助手消息
  if (part.type === 'tool-error') throw part.error       // 工具参数解析失败按模型错误处理
  if (part.type === 'error') throw normalizeError(part.error) // 流内错误交给 retry 分类
  if (part.type === 'abort') throw new DOMException('model request aborted', 'AbortError') // requestTurn 统一区分停止和超时
}


// --- 追加文本增量 ---
function appendTextDelta(part, state) {
  const block = state.textBlocks.get(part.id) ?? addTextBlock(state.message, state.textBlocks, part.id) // 兼容未发送 start 的供应商
  block.text.text += part.text                           // 将文本增量写入 store 结构
  Session.emit(state.sessionId, 'text-delta', { messageId: state.message.id, text: part.text }) // 实时反馈文本
}


// --- 追加思考增量 ---
function appendThinkingDelta(part, state) {
  const block = state.thinkingBlocks.get(part.id) ?? addThinkingBlock(state.message, state.thinkingBlocks, part.id) // 兼容未发送 start 的供应商
  block.thinking.thinking += part.text                   // 将思考增量写入 store 结构
  Session.emit(state.sessionId, 'thinking-delta', { messageId: state.message.id, thinking: part.text }) // 实时反馈思考
}


// --- 追加工具调用 ---
function appendToolCall(part, state) {
  const toolCall = { type: 'tool_call', toolCallId: part.toolCallId, toolName: part.toolName, input: part.input, status: 'pending' } // 保存完整工具调用
  state.message.content.push(toolCall)                   // 工具调用按模型输出顺序进入消息
  Session.emit(state.sessionId, 'tool-call', { messageId: state.message.id, toolCall: structuredClone(toolCall) }) // 反馈完整调用
}


// --- 添加文本块 ---
function addTextBlock(message, blocks, id) {
  const block = { type: 'text', text: { text: '' } }     // 文本块严格符合 store 结构
  message.content.push(block)                             // 保留与思考和工具调用的顺序
  blocks.set(id, block)                                   // 登记流 ID 供后续增量定位
  return block                                            // 返回可追加内容的真实对象
}


// --- 添加思考块 ---
function addThinkingBlock(message, blocks, id) {
  const block = { type: 'thinking', thinking: { thinking: '' } } // 思考块严格符合 store 结构
  message.content.push(block)                             // 保留模型原始输出顺序
  blocks.set(id, block)                                   // 登记流 ID 供后续增量定位
  return block                                            // 返回可追加思考的真实对象
}


// --- 转换模型上下文 ---
function toModelMessages(messages) {
  return messages.map((message, index) => toModelMessage(messages, message, index)) // 逐条转换并保留原始上下文顺序
}


// --- 转换一条模型消息 ---
function toModelMessage(messages, message, index) {
  if (message.role === 'user') {
    const content = message.content
      .filter((block) => block.type === 'text')          // 用户消息只发送文本块
      .map((block) => ({ type: 'text', text: block.text.text })) // 还原 SDK 文本格式
    return { role: 'user', content }                     // 返回用户上下文消息
  }
  if (message.role === 'assistant') {
    return { role: 'assistant', content: toAssistantContent(message.content) } // 助手内容排除不重放的思考块
  }
  return { role: 'tool', content: toToolContent(messages, message.content, index) } // 工具结果恢复调用名称和输出格式
}


// --- 转换助手内容 ---
function toAssistantContent(content) {
  return content.flatMap((block) => {
    if (block.type === 'text') return [{ type: 'text', text: block.text.text }] // 助手文本直接还原
    if (block.type === 'tool_call') return [{ type: 'tool-call', toolCallId: block.toolCallId, toolName: block.toolName, input: block.input }] // 工具调用恢复 SDK 格式
    return []                                            // 思考内容不重新发送给模型
  })
}


// --- 转换工具内容 ---
function toToolContent(messages, content, beforeIndex) {
  return content
    .filter((block) => block.type === 'tool_result')     // 工具消息只发送结果块
    .map((block) => ({
      type: 'tool-result',                               // AI SDK 使用连字符类型名称
      toolCallId: block.toolCallId,                      // 与前面的工具调用建立对应关系
      toolName: findToolName(messages, beforeIndex, block.toolCallId), // 从前面的工具调用恢复名称
      output: { type: block.isError ? 'error-text' : 'text', value: stringifyOutput(block.output) }, // 结果统一转换为文本输出
    }))
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
  if (error instanceof Error) return error               // 原始 Error 保留状态和 retry 分类
  const message = typeof error?.message === 'string' ? error.message : String(error) // 优先保留对象中的错误文案
  return Object.assign(new Error(message), typeof error === 'object' && error ? error : {}) // 普通错误对象保留状态和 retry 分类
}


// --- 区分用户停止和请求超时 ---
function throwRequestAbort(abortSignal, timeoutSignal, timeoutMs) {
  if (abortSignal.aborted) throw abortSignal.reason ?? new DOMException('operation aborted', 'AbortError') // 用户停止保持 AbortError
  if (timeoutSignal.aborted) throw Object.assign(new Error(`model request timed out after ${timeoutMs}ms`), { status: 408 }) // 超时作为可重试错误
  throw new DOMException('model request aborted', 'AbortError') // 其他中断不自动重试
}


// --- 停止 Agent ---
async function stop(id) {
  const session = await Session.getMutable(id)           // 读取目标会话运行状态
  if (!session) throw businessError(404, 'session not found') // 未知会话不能停止
  const controller = session.abortController             // 保存本轮控制器供等待后台清理
  const execution = controller && runCompletions.get(controller) // 保存本轮后台完成时刻
  controller?.abort(new DOMException('stopped by user', 'AbortError')) // 中断模型请求和退避等待
  await Tool.stopAll(id)                                 // 并行终止全部工具进程
  await execution?.catch(() => {})                       // 等待 Agent finally 完成，删除会话时不会被重新写回
  if (controller && session.abortController !== controller) return { status: session.status } // 新执行已开始时不覆盖它的运行状态
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
