/*
Agent 指令集：接收用户消息、运行完整 Agent 循环，并停止当前任务。
run() 从上到下完整展示“请求 LLM、保存回复、执行工具、带结果继续请求、结束任务”的全部过程。
调用示例：await Agent.send(sessionID, '分析项目')、await Agent.stop(sessionID)。
*/
import { LLM } from '../utils/llm.js'                    // 引入完整单轮 LLM 请求能力
import { createLLMMessages } from '../utils/message.js'  // 引入纯消息格式转换能力
import { Retry } from '../utils/retry.js'                // 引入可中断的无限重试能力
import { store } from '../store.js'                      // 引入模型供应商配置
import { Session } from './session.js'                   // 引入会话读写和 SSE 反馈
import { Tool } from './tool.js'                         // 引入工具定义、执行和停止能力

const toolPrompt = '继续完成用户任务。需要外部操作时必须调用可用工具，不要只描述计划。' // 第二次纯文本后只提醒下一轮模型
const runs = new WeakMap()                               // 当前停止控制器对应的完整 Agent 任务


// --- 接收用户消息 ---
async function send(sessionID, content) {
  const session = await Session.getMutable(sessionID)    // 读取当前会话真实对象
  if (!session) throw Object.assign(new Error('session not found'), { status: 404 }) // 未知会话不能启动 Agent
  if (session.status !== 'idle' || session.abortController) throw Object.assign(new Error('session is not idle'), { status: 409 }) // 上一轮彻底结束前拒绝重叠执行
  if (typeof content !== 'string' || !content.trim()) throw Object.assign(new Error('message content must not be empty'), { status: 400 }) // 空消息没有执行目标

  const message = {                                      // 创建严格符合 store 的用户消息
    id: Session.createMessageId(),                       // 生成消息身份
    role: 'user',                                        // 标记消息来自用户
    content: [{ type: 'text', text: { text: content.trim() } }], // 保存去除首尾空格的正文
  }
  session.messages.push(message)                         // 用户消息进入后续模型上下文
  session.status = 'running'                             // 会话立即进入执行状态
  session.textOnlyCount = 0                              // 新任务从零统计纯文本轮次
  const controller = new AbortController()               // 本轮 LLM、重试和工具共享停止信号
  session.abortController = controller                   // stop 通过会话定位当前任务

  const firstSave = Session.save(sessionID)              // 启动 LLM 前先持久化用户输入
  const running = run(session, message, controller, firstSave) // 后台开始完整 Agent 循环
  runs.set(controller, running)                          // stop 和删除可以等待本轮彻底完成
  try { await firstSave }                                // HTTP 成功只代表用户消息已安全落盘
  catch (error) {
    await running                                        // 等待 run 记录错误并释放运行状态
    throw error                                          // 将保存错误反馈给调用方
  }
  return { messageId: message.id }                       // 返回前端可追踪的消息身份
}


// --- 运行完整 Agent 循环 ---
async function run(session, userMessage, controller, firstSave) {
  const sessionID = session.id                           // 本轮所有数据和反馈都归属同一会话
  let nextPrompt = ''                                    // 临时提醒默认不参与模型上下文
  let hasStarted = false                                 // 区分用户消息保存失败和执行失败

  try {
    await firstSave                                      // 用户消息必须先安全落盘
    hasStarted = true                                    // 从此处开始的错误属于 Agent 执行阶段
    Session.emit(sessionID, 'message', { message: structuredClone(userMessage) }) // 落盘后反馈用户消息
    Session.emit(sessionID, 'status', { status: 'running' }) // 告知客户端 Agent 已经开始

    while (!controller.signal.aborted) {
      const answer = await Retry.run(async () => {       // 每轮 LLM 请求对可恢复错误无限重试
        const provider = store.config.provider           // 每次重试都读取最新供应商配置
        if (!provider?.api || !provider?.key) throw Object.assign(new Error('provider api and key must be configured'), { status: 400 }) // 缺少认证不能请求 LLM
        if (!session.model) throw Object.assign(new Error('session model must be configured'), { status: 400 }) // 会话必须明确模型

        const configuredTimeout = Number(process.env.AGENT_REQUEST_TIMEOUT_MS ?? 120000) // 读取单次请求预算
        const timeoutMS = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? Math.floor(configuredTimeout) : 120000 // 非法值回退两分钟
        const timeoutSignal = AbortSignal.timeout(timeoutMS) // 单轮超时后交给 Retry 重新请求
        const requestSignal = AbortSignal.any([controller.signal, timeoutSignal]) // 用户停止和单轮超时都能中断流
        const messages = createLLMMessages(session.messages) // 把持久化历史转换为 LLM 消息
        if (nextPrompt) messages.push({ role: 'user', content: nextPrompt }) // 临时提醒不写入会话历史
        const messageID = Session.createMessageId()      // 每次重试使用独立的流式消息身份

        try {
          const result = await LLM.chat({                // utils 完整处理模型客户端和响应流
            apiURL: provider.api,                        // 使用当前 OpenAI-compatible 地址
            apiKey: provider.key,                        // 使用当前原始密钥
            model: session.model,                        // 使用会话选择的模型
            systemPrompt: '',                            // Core 当前没有额外系统提示
            messages,                                    // 发送完整会话上下文
            tools: Tool.definitions(),                   // 工具定义来自启动扫描结果
            signal: requestSignal,                       // 停止或超时中断当前响应流
            onEvent(type, data) {
              if (type === 'text-delta') Session.emit(sessionID, 'text-delta', { messageId: messageID, text: data.delta }) // 实时反馈文本
              if (type === 'thinking-delta') Session.emit(sessionID, 'thinking-delta', { messageId: messageID, thinking: data.delta }) // 实时反馈思考
              if (type === 'tool-call-ready') {
                const toolCall = { type: 'tool_call', toolCallId: data.toolCallId, toolName: data.toolName, input: data.input, status: 'pending' } // 完整工具调用符合 store
                Session.emit(sessionID, 'tool-call', { messageId: messageID, toolCall }) // 参数完整后反馈工具调用
              }
            },
          })
          requestSignal.throwIfAborted()                 // 供应商没有 abort 事件时也不能吞掉中断
          return { ...result, messageID }                // 成功尝试携带最终助手消息身份
        } catch (error) {
          if (controller.signal.aborted) throw controller.signal.reason ?? new DOMException('operation aborted', 'AbortError') // 用户停止立即结束整个 Agent
          if (timeoutSignal.aborted) throw Object.assign(new Error(`model request timed out after ${timeoutMS}ms`), { status: 408 }) // 单轮超时进入 Retry
          const failure = error instanceof Error ? error : Object.assign(new Error(String(error)), error) // 普通抛出值转成可分类错误
          if (failure.status === undefined && failure.statusCode !== undefined) failure.status = failure.statusCode // 统一 SDK 的 HTTP 状态字段
          if (failure.code === undefined && failure.cause?.code !== undefined) failure.code = failure.cause.code // 统一 SDK 的网络错误代码
          throw failure                                  // Retry 判断是否再次请求
        }
      }, {
        signal: controller.signal,                       // 停止同时中断请求和退避等待
        onRetry({ attempt, delay, error }) {
          const message = error instanceof Error ? error.message : String(error) // SSE 始终使用稳定错误文本
          Session.emit(sessionID, 'error', { message, attempt, nextRetryIn: delay }) // 反馈重试原因和等待时间
        },
      })
      nextPrompt = ''                                    // 临时提醒只参与紧接着的一轮

      const assistantMessage = {                        // LLM 完整结果组成助手消息
        id: answer.messageID,                            // 使用成功请求的流式消息身份
        role: 'assistant',                               // 标记消息来自 LLM
        content: answer.contentBlocks.map((block) => {
          if (block.type === 'text') return { type: 'text', text: { text: block.text } } // 文本转成 store 结构
          if (block.type === 'thinking') return { type: 'thinking', thinking: { thinking: block.thinking } } // 思考转成 store 结构
          return { type: 'tool_call', toolCallId: block.toolCallId, toolName: block.toolName, input: block.input, status: block.status } // 工具调用保留完整字段
        }),
      }
      session.messages.push(assistantMessage)            // 助手消息进入下一轮上下文
      Session.emit(sessionID, 'message', { message: structuredClone(assistantMessage) }) // 反馈完整助手消息
      await Session.save(sessionID)                      // 每轮模型结束后保存完整回复

      if (answer.toolCalls.length === 0) {
        session.textOnlyCount += 1                       // 没有行动时累计纯文本轮次
        if (session.textOnlyCount >= 3) break            // 第三次保留回复并结束任务
        if (session.textOnlyCount === 2) nextPrompt = toolPrompt // 第二次后提醒下一轮使用工具
        continue                                         // 没有工具结果时直接请求下一轮 LLM
      }

      session.textOnlyCount = 0                          // 调用工具后重新统计纯文本轮次
      const toolRun = await Tool.runAll(sessionID, answer.toolCalls) // 同一轮全部工具并行执行
      controller.signal.throwIfAborted()                 // 停止期间完成的工具结果不能写回会话
      const toolMessage = { id: Session.createMessageId(), role: 'tool', content: toolRun.results } // 工具结果组成观察消息
      session.messages.push(toolMessage)                 // 观察结果进入下一轮 LLM 上下文
      for (const toolResult of toolRun.results) Session.emit(sessionID, 'tool-result', { messageId: toolMessage.id, toolResult: structuredClone(toolResult) }) // 逐个反馈工具结果
      Session.emit(sessionID, 'message', { message: structuredClone(toolMessage) }) // 反馈完整工具消息
      await Session.save(sessionID)                      // 工具轮次结束后保存全部结果
      if (toolRun.shouldStop) break                      // finish 工具明确结束当前任务
    }

    session.status = 'idle'                              // 正常完成或主动停止都回到空闲
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error) // 所有最终错误使用稳定文本
    if (!hasStarted) {
      session.status = 'error'                           // 用户消息保存失败不能伪装成正常停止
      Session.emit(sessionID, 'error', { message })      // 反馈用户消息保存失败
    } else if (controller.signal.aborted || error?.name === 'AbortError') {
      session.status = 'idle'                            // 用户停止不是执行错误
    } else {
      session.status = 'error'                           // 不可重试错误保留错误状态
      Session.emit(sessionID, 'error', { message })      // 反馈最终失败原因
    }
  } finally {
    session.textOnlyCount = 0                            // 下次任务重新统计纯文本轮次
    try { await Session.save(sessionID) }                // 最终状态必须真实写入磁盘
    catch (error) {
      session.status = 'error'                           // 保存失败不能向客户端伪报成功
      Session.emit(sessionID, 'error', { message: error instanceof Error ? error.message : String(error) }) // 反馈持久化失败
    }
    if (session.abortController === controller) session.abortController = null // 最终保存完成后释放当前控制器
    runs.delete(controller)                              // 本轮任务完成后释放等待引用
    Session.emit(sessionID, 'status', { status: session.status }) // 反馈最终状态
  }
}


// --- 停止当前任务 ---
async function stop(sessionID) {
  const session = await Session.getMutable(sessionID)    // 读取目标会话运行状态
  if (!session) throw Object.assign(new Error('session not found'), { status: 404 }) // 未知会话不能停止
  const controller = session.abortController             // 保存当前控制器供等待后台结束
  const running = controller && runs.get(controller)     // 定位当前完整 Agent 任务

  controller?.abort(new DOMException('stopped by user', 'AbortError')) // 中断 LLM、重试和工具等待
  await Tool.stopAll(sessionID)                          // 中止本轮全部工具
  if (running) {
    await running.catch(() => {})                        // 等待 run 的最终保存和状态反馈
    if (session.abortController && session.abortController !== controller) return { status: session.status } // 新任务已经接管时不覆盖状态
    return { status: session.status }                    // run 已经完成空闲状态保存
  }

  session.abortController = null                         // 没有后台任务时直接清除旧控制器
  session.textOnlyCount = 0                              // 下次任务重新计数
  session.status = 'idle'                                // error 或残留状态恢复空闲
  await Session.save(sessionID)                          // 保存停止后的最终状态
  Session.emit(sessionID, 'status', { status: session.status }) // 反馈停止结果
  return { status: session.status }                      // 返回当前会话状态
}


export const Agent = { send, stop }                      // 导出用户可触发的发送和停止指令
