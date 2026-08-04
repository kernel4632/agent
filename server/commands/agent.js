/*
Agent 指令集：接收用户消息、运行完整 Agent 循环，并停止当前任务。
run() 从上到下完整展示“请求 LLM、保存回复、执行工具、带结果继续请求、结束任务”的全部过程。
调用示例：await Agent.send(sessionID, '分析项目')、await Agent.stop(sessionID)。
*/
import { LLM } from '../utils/llm.js'                    // 引入完整单轮 LLM 请求能力
import { Retry } from '../utils/retry.js'                // 引入可中断的无限重试能力
import { store } from '../store.js'                      // 引入模型供应商配置
import { Session } from './session.js'                   // 引入会话读写和 SSE 反馈
import { definitions, runAll, stopAll } from './tool.js' // 引入工具定义、执行和停止能力

const toolPrompt = '继续完成用户任务。需要外部操作时必须调用可用工具，不要只描述计划。' // 第二次纯文本后只提醒下一轮模型
const runs = new WeakMap()                               // 当前停止控制器对应的完整 Agent 任务


// --- 接收用户消息 ---
async function send(sessionID, content) {
  const session = await Session.getMutable(sessionID)    // 读取当前会话真实对象
  if (!session) throw Object.assign(new Error('session not found'), { status: 404 }) // 未知会话不能启动 Agent
  if (session.status !== 'idle' || session.abortController) throw Object.assign(new Error('session is not idle'), { status: 409 }) // 上一轮彻底结束前拒绝重叠执行
  const message = { id: Session.createMessageId(), role: 'user', content: [{ type: 'text', text: content }] } // 项目只给 AI SDK 用户消息增加持久化身份
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
        const messages = nextPrompt ? [...session.messages, { role: 'user', content: nextPrompt }] : session.messages // 持久化历史直接传给 AI SDK，临时提醒只扩展本轮数组
        const messageID = Session.createMessageId()      // 每次重试使用独立的流式消息身份

        const result = await LLM.chat({                  // utils 完整处理模型客户端、超时和响应流
          apiURL: provider.api,                          // 使用当前 OpenAI-compatible 地址
          apiKey: provider.key,                          // 使用当前原始密钥
          model: session.model,                          // 使用会话选择的模型
          systemPrompt: '',                              // Core 当前没有额外系统提示
          messages,                                      // 发送完整会话上下文
          tools: definitions(),                          // 工具定义来自启动扫描结果
          signal: controller.signal,                     // 用户停止中断当前响应流
          onEvent(type, data) {
            if (type === 'text-delta') Session.emit(sessionID, 'text-delta', { messageId: messageID, text: data.delta }) // 实时反馈正文增量
            if (type === 'reasoning-delta') Session.emit(sessionID, 'reasoning-delta', { messageId: messageID, text: data.delta }) // 实时反馈推理增量
            if (type === 'tool-call') Session.emit(sessionID, 'tool-call', { messageId: messageID, toolCall: data }) // 完整参数到达后反馈 AI SDK 工具调用
          },
        })
        return { ...result, messageID }                  // 成功尝试携带最终助手消息身份
      }, {
        signal: controller.signal,                       // 停止同时中断请求和退避等待
        onRetry({ attempt, delay, error }) {
          const message = error instanceof Error ? error.message : String(error) // SSE 始终使用稳定错误文本
          Session.emit(sessionID, 'error', { message, attempt, nextRetryIn: delay }) // 反馈重试原因和等待时间
        },
      })
      nextPrompt = ''                                    // 临时提醒只参与紧接着的一轮

      const assistantMessage = { id: answer.messageID, role: 'assistant', content: answer.contentBlocks } // AI SDK 原生 blocks 直接成为助手消息内容
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
      const toolRun = await runAll(sessionID, answer.toolCalls) // 同一轮全部工具并行执行
      controller.signal.throwIfAborted()                 // 停止期间完成的工具结果不能写回会话
      const toolMessage = { id: Session.createMessageId(), role: 'tool', content: toolRun.results } // AI SDK ToolResultPart 组成观察消息
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
  await stopAll(sessionID)                               // 中止本轮全部工具
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
