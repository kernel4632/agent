/*
Agent 指令集：接收用户消息，并用一个完整循环反复执行“请求 LLM、保存回复、运行工具”。
LLM、工具和重试的协议细节由 utils 封装，本文件只保留项目自研的 Agent 行为和会话反馈。
调用示例：await Agent.send(sessionID, '分析项目')、await Agent.stop(sessionID)。
*/
import { LLM } from '../utils/llm.js'                    // 引入完整单轮 LLM 请求能力
import { Retry } from '../utils/retry.js'                // 引入可中断的无限重试能力
import { store } from '../store.js'                      // 引入模型供应商配置
import { Session } from './session.js'                   // 引入会话读写和 SSE 反馈
import { Tool } from './tool.js'                         // 引入工具定义、执行和停止能力

const toolReminder = '继续完成用户任务。需要外部操作时必须调用可用工具，不要只描述计划。' // 第二次纯文本后只提醒下一轮模型
const runningAgents = new WeakMap()                      // 当前控制器对应完整后台生命周期


// --- 接收用户消息并启动 Agent ---
async function send(sessionID, content) {
  const session = await Session.getMutable(sessionID)    // 读取当前会话真实对象
  if (!session) throw businessError(404, 'session not found') // 未知会话不能启动 Agent
  if (session.status !== 'idle' || session.abortController) throw businessError(409, 'session is not idle') // 上一轮彻底结束前拒绝重叠执行
  if (typeof content !== 'string' || !content.trim()) throw businessError(400, 'message content must not be empty') // 空消息没有执行目标

  const message = {                                      // 创建严格符合 store 的用户消息
    id: Session.createMessageId(),                       // 生成消息身份
    role: 'user',                                        // 标记消息来自用户
    content: [{ type: 'text', text: { text: content.trim() } }], // 保存去除首尾空格的正文
  }
  session.messages.push(message)                         // 用户消息进入后续模型上下文
  session.status = 'running'                             // 会话立即进入执行状态
  session.textOnlyCount = 0                              // 新任务从零统计纯文本轮次
  const controller = new AbortController()               // 本轮模型、重试和工具共享停止信号
  session.abortController = controller                   // stop 指令通过会话定位当前执行

  const firstSave = Session.save(sessionID)              // LLM 启动前先持久化用户输入
  const execution = startAgent(sessionID, session, message, controller, firstSave) // 登记完整后台生命周期
  try { await firstSave }                                // HTTP 成功只代表用户消息已安全落盘
  catch (error) {
    await execution                                      // 等待后台记录启动错误并释放状态
    throw error                                          // 将持久化错误反馈给调用方
  }
  return { messageId: message.id }                       // 返回前端可追踪的消息身份
}


// --- 登记后台 Agent 生命周期 ---
function startAgent(sessionID, session, message, controller, firstSave) {
  const execution = runAgent(sessionID, session, message, controller, firstSave).catch(() => {}) // 最终错误已经写入会话和 SSE
  runningAgents.set(controller, execution)              // stop 和删除可以等待本轮彻底完成
  return execution                                       // send 在启动失败时复用同一个完成时刻
}


// --- 执行完整 Agent 循环 ---
async function runAgent(sessionID, session, userMessage, controller, firstSave) {
  let reminder = ''                                      // 临时提醒默认不参与模型上下文
  let hasStarted = false                                 // 区分启动保存失败和执行阶段失败
  try {
    await firstSave                                      // 用户消息必须先安全落盘
    hasStarted = true                                    // 从此处开始错误属于 Agent 执行阶段
    Session.emit(sessionID, 'message', { message: structuredClone(userMessage) }) // 落盘后反馈用户消息
    Session.emit(sessionID, 'status', { status: 'running' }) // 告知客户端 Agent 已经开始

    while (!controller.signal.aborted) {
      const result = await Retry.run(                    // 每轮 LLM 请求对可恢复错误无限重试
        () => requestLLM(session, reminder, controller.signal), // 使用当前完整会话请求一轮模型
        {
          signal: controller.signal,                     // 停止同时中断请求和退避等待
          onRetry: ({ attempt, delay, error }) => Session.emit(sessionID, 'error', { message: normalizeError(error).message, attempt, nextRetryIn: delay }), // 反馈本次退避
        },
      )
      reminder = ''                                      // 提醒只参与紧接着的一轮

      const assistantMessage = { id: result.messageID, role: 'assistant', content: toStoreBlocks(result.contentBlocks) } // 成功尝试的完整结果组成助手消息
      session.messages.push(assistantMessage)            // 助手消息进入下一轮上下文
      Session.emit(sessionID, 'message', { message: structuredClone(assistantMessage) }) // 反馈完整助手消息
      await Session.save(sessionID)                      // 每轮模型结束后保存完整回复

      if (result.toolCalls.length === 0) {
        session.textOnlyCount += 1                       // 没有行动时累计纯文本轮次
        if (session.textOnlyCount >= 3) break            // 第三次保留回复并结束任务
        if (session.textOnlyCount === 2) reminder = toolReminder // 第二次后提醒下一轮使用工具
        continue                                         // 继续请求下一轮模型
      }

      session.textOnlyCount = 0                          // 调用工具后重新统计纯文本轮次
      const toolRun = await Tool.runAll(sessionID, result.toolCalls) // 同一轮全部工具并行执行
      controller.signal.throwIfAborted()                 // 停止期间完成的结果不能写回会话
      const toolMessage = { id: Session.createMessageId(), role: 'tool', content: toolRun.results } // 工具结果组成观察消息
      session.messages.push(toolMessage)                 // 观察结果进入下一轮模型上下文
      for (const toolResult of toolRun.results) Session.emit(sessionID, 'tool-result', { messageId: toolMessage.id, toolResult: structuredClone(toolResult) }) // 逐个反馈工具结果
      Session.emit(sessionID, 'message', { message: structuredClone(toolMessage) }) // 反馈完整工具消息
      await Session.save(sessionID)                      // 工具轮次结束后保存全部结果
      if (toolRun.shouldStop) break                      // finish 工具明确结束当前任务
    }

    session.status = 'idle'                              // 正常完成或主动停止都回到空闲
  } catch (error) {
    if (!hasStarted) {
      session.status = 'error'                           // 启动保存失败不能伪装成正常停止
      Session.emit(sessionID, 'error', { message: normalizeError(error).message }) // 反馈用户消息保存失败
    }
    else if (controller.signal.aborted || error?.name === 'AbortError') session.status = 'idle' // 用户停止不是执行错误
    else {
      session.status = 'error'                           // 不可重试错误保留错误状态
      Session.emit(sessionID, 'error', { message: normalizeError(error).message }) // 反馈最终失败原因
    }
  } finally {
    await finishAgent(sessionID, session, controller)    // 最终保存、释放控制器并反馈状态
  }
}


// --- 请求一轮完整 LLM 响应 ---
async function requestLLM(session, reminder, abortSignal) {
  const provider = store.config.provider                 // 每轮读取最新模型配置
  if (!provider?.api || !provider?.key) throw businessError(400, 'provider api and key must be configured') // 缺少认证不能发起请求
  if (!session.model) throw businessError(400, 'session model must be configured') // 会话必须明确模型
  const configuredTimeout = Number(process.env.AGENT_REQUEST_TIMEOUT_MS ?? 120000) // 读取可选单次请求预算
  const timeoutMS = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? Math.floor(configuredTimeout) : 120000 // 非法值回退两分钟
  const timeoutSignal = AbortSignal.timeout(timeoutMS)   // 单轮超时后交给 Retry 重新请求
  const requestSignal = AbortSignal.any([abortSignal, timeoutSignal]) // 用户停止和单轮超时任一中断 LLM
  const messages = toModelMessages(session.messages)    // 把 store 历史转换为 AI SDK 消息
  if (reminder) messages.push({ role: 'user', content: reminder }) // 临时提醒不写入 store
  const messageID = Session.createMessageId()            // 每次重试使用独立流事件身份
  try {
    const result = await LLM.chat({                       // utils 封装完整处理模型客户端和响应流
      apiURL: provider.api,                              // 使用当前 OpenAI-compatible 地址
      apiKey: provider.key,                              // 使用当前原始密钥
      model: session.model,                              // 使用会话选择的模型
      systemPrompt: '',                                  // Core 当前没有额外系统提示
      messages,                                          // 发送完整会话上下文
      tools: Tool.definitions(),                         // 工具定义来自启动扫描结果
      signal: requestSignal,                             // 停止或超时中断请求
      onEvent: (type, data) => emitLLMEvent(session.id, messageID, type, data), // 将 LLM 增量转成现有 SSE 协议
    })
    requestSignal.throwIfAborted()                       // 无 abort 事件的供应商也不能吞掉中断
    return { ...result, messageID }                      // 成功尝试携带最终助手消息身份
  } catch (error) {
    if (requestSignal.aborted) throwRequestAbort(abortSignal, timeoutSignal, timeoutMS) // 统一区分停止和超时
    throw normalizeLLMError(error)                       // 统一 SDK 状态供 Retry 分类
  }
}


// --- 反馈 LLM 流事件 ---
function emitLLMEvent(sessionID, messageID, type, data) {
  if (type === 'text-delta') Session.emit(sessionID, 'text-delta', { messageId: messageID, text: data.delta }) // 文本增量沿用现有 SSE 格式
  if (type === 'thinking-delta') Session.emit(sessionID, 'thinking-delta', { messageId: messageID, thinking: data.delta }) // 思考增量沿用现有 SSE 格式
  if (type === 'tool-call-ready') {
    const toolCall = { type: 'tool_call', toolCallId: data.toolCallId, toolName: data.toolName, input: data.input, status: 'pending' } // 完整工具调用符合 store
    Session.emit(sessionID, 'tool-call', { messageId: messageID, toolCall }) // 工具参数完整后再反馈调用
  }
}


// --- 转换 LLM 内容块 ---
function toStoreBlocks(contentBlocks) {
  return contentBlocks.map((block) => {
    if (block.type === 'text') return { type: 'text', text: { text: block.text } } // 文本转成 store 嵌套结构
    if (block.type === 'thinking') return { type: 'thinking', thinking: { thinking: block.thinking } } // 思考转成 store 嵌套结构
    return { type: 'tool_call', toolCallId: block.toolCallId, toolName: block.toolName, input: block.input, status: block.status } // 工具调用直接保留字段
  })
}


// --- 转换模型上下文 ---
function toModelMessages(messages) {
  return messages.map((message, index) => {
    if (message.role === 'user') return { role: 'user', content: message.content.filter((block) => block.type === 'text').map((block) => ({ type: 'text', text: block.text.text })) } // 用户消息只发送文本
    if (message.role === 'assistant') return { role: 'assistant', content: message.content.flatMap((block) => {
      if (block.type === 'text') return [{ type: 'text', text: block.text.text }] // 助手文本直接还原
      if (block.type === 'tool_call') return [{ type: 'tool-call', toolCallId: block.toolCallId, toolName: block.toolName, input: block.input }] // 工具调用恢复 SDK 格式
      return []                                          // 思考内容不重新发送给模型
    }) }
    return { role: 'tool', content: message.content.filter((block) => block.type === 'tool_result').map((block) => ({
      type: 'tool-result',                               // AI SDK 使用连字符类型名称
      toolCallId: block.toolCallId,                      // 与前面的工具调用对应
      toolName: findToolName(messages, index, block.toolCallId), // 从历史调用恢复工具名
      output: { type: block.isError ? 'error-text' : 'text', value: stringifyOutput(block.output) }, // 结果统一转换为文本
    })) }
  })
}


// --- 查找工具名称 ---
function findToolName(messages, beforeIndex, toolCallID) {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const call = messages[index].content.find((block) => block.type === 'tool_call' && block.toolCallId === toolCallID) // 从最近消息向前匹配调用
    if (call) return call.toolName                        // 找到后返回原始工具名
  }
  return 'unknown_tool'                                  // 损坏历史使用稳定占位名
}


// --- 完成 Agent 生命周期 ---
async function finishAgent(sessionID, session, controller) {
  session.textOnlyCount = 0                              // 下次任务重新统计纯文本轮次
  try { await Session.save(sessionID) }                  // 最终状态必须真实写入磁盘
  catch (error) {
    session.status = 'error'                             // 保存失败不能向客户端伪报成功
    Session.emit(sessionID, 'error', { message: normalizeError(error).message }) // 反馈持久化失败
  }
  if (session.abortController === controller) session.abortController = null // 最终保存完成后释放当前控制器
  Session.emit(sessionID, 'status', { status: session.status }) // 反馈最终状态
}


// --- 停止 Agent ---
async function stop(sessionID) {
  const session = await Session.getMutable(sessionID)    // 读取目标会话运行状态
  if (!session) throw businessError(404, 'session not found') // 未知会话不能停止
  const controller = session.abortController             // 保存当前控制器供等待后台清理
  const execution = controller && runningAgents.get(controller) // 定位当前完整 Agent 生命周期
  controller?.abort(new DOMException('stopped by user', 'AbortError')) // 中断 LLM 请求和退避等待
  await Tool.stopAll(sessionID)                          // 中止本轮全部工具
  await execution?.catch(() => {})                       // 等待 finally 完成，避免删除后迟到保存
  if (controller && session.abortController !== controller) return { status: session.status } // 新任务接管时不覆盖状态
  session.abortController = null                         // 清除当前停止控制器
  session.textOnlyCount = 0                              // 下次执行重新计数
  session.status = 'idle'                                // 停止后恢复空闲
  await Session.save(sessionID)                          // 保存最终状态
  Session.emit(sessionID, 'status', { status: session.status }) // 反馈停止结果
  return { status: session.status }                      // 返回当前会话状态
}


// --- 区分用户停止和请求超时 ---
function throwRequestAbort(abortSignal, timeoutSignal, timeoutMS) {
  if (abortSignal.aborted) throw abortSignal.reason ?? new DOMException('operation aborted', 'AbortError') // 用户停止保持 AbortError
  if (timeoutSignal.aborted) throw Object.assign(new Error(`model request timed out after ${timeoutMS}ms`), { status: 408 }) // 超时交给 Retry
  throw new DOMException('model request aborted', 'AbortError') // 其他中断不自动重试
}


// --- 统一普通错误 ---
function normalizeError(error) {
  if (error instanceof Error) return error               // 保留原始错误状态和代码
  const message = typeof error?.message === 'string' ? error.message : String(error) // 优先读取错误文案
  return Object.assign(new Error(message), typeof error === 'object' && error ? error : {}) // 普通对象转换为 Error
}


// --- 统一 LLM 错误分类字段 ---
function normalizeLLMError(error) {
  const failure = normalizeError(error)                  // 先保留原始 Error 和属性
  if (failure.status === undefined && failure.statusCode !== undefined) failure.status = failure.statusCode // Retry 使用统一 HTTP 状态字段
  if (failure.code === undefined && failure.cause?.code !== undefined) failure.code = failure.cause.code // Retry 使用统一网络错误代码
  return failure                                         // 返回可直接交给 Retry 的错误
}


// --- 转换工具输出文本 ---
function stringifyOutput(output) {
  return typeof output === 'string' ? output : JSON.stringify(output) // 对象结果使用 JSON 保留结构
}


// --- 创建业务错误 ---
function businessError(status, message) {
  return Object.assign(new Error(message), { status })   // server.js 根据 status 返回 HTTP 错误
}


export const Agent = { send, stop }                      // 导出用户可触发的发送和停止指令
