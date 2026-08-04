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

const runs = new WeakMap()                               // 当前停止控制器对应的完整 Agent 任务


// --- 接收用户消息 ---
async function send(sessionID, content) {
  const session = await Session.getMutable(sessionID)    // 读取当前会话真实对象
  if (!session) throw Object.assign(new Error('session not found'), { status: 404 }) // 未知会话不能启动 Agent
  if (session.status !== 'idle' || session.abortController) throw Object.assign(new Error('session is not idle'), { status: 409 }) // 上一轮彻底结束前拒绝重叠执行
  const message = { id: Session.createMessageId(), role: 'user', content: [{ type: 'text', text: content }] } // 项目只给 AI SDK 用户消息增加持久化身份
  session.messages.push(message)                         // 用户消息进入后续模型上下文
  session.status = 'running'                             // 会话立即进入执行状态
  const controller = new AbortController()               // 本轮 LLM、重试和工具共享停止信号
  session.abortController = controller                   // stop 通过会话定位当前任务

  try { await Session.save(sessionID) }                  // 启动 LLM 前先持久化用户输入
  catch (error) {
    session.status = 'error'                             // 启动保存失败时不创建后台任务
    session.abortController = null                       // 释放尚未使用的停止控制器
    Session.emit(sessionID, 'error', { message: error instanceof Error ? error.message : String(error) }) // 反馈真实保存错误
    Session.emit(sessionID, 'status', { status: session.status }) // 反馈错误终态
    throw error                                          // 将保存错误反馈给调用方
  }
  Session.emit(sessionID, 'message', { message: structuredClone(message) }) // 落盘后反馈用户消息
  Session.emit(sessionID, 'status', { status: 'running' }) // 告知客户端 Agent 已经开始

  const running = run(session, controller).then(
    () => Session.finish(session, controller),           // 正常结束交给会话生命周期收尾
    (error) => Session.finish(session, controller, error), // 停止或失败也走同一收尾动作
  ).finally(() => runs.delete(controller))               // 释放本轮后台任务引用
  runs.set(controller, running)                          // stop 和删除可以等待本轮彻底完成
  return { messageId: message.id }                       // 返回前端可追踪的消息身份
}


// --- 运行完整 Agent 循环 ---
async function run(session, controller) {
  const sessionID = session.id                           // 本轮所有数据和反馈都归属同一会话
  let nextPrompt = ''                                    // 临时提醒默认不参与模型上下文
  let textOnlyCount = 0                                  // 只属于本轮 Agent 的纯文本次数

  while (!controller.signal.aborted) {
    const answer = await Retry.run(async () => {         // 每轮 LLM 请求对可恢复错误无限重试
      const provider = store.config.provider             // 每次重试都读取最新供应商配置
      const messages = nextPrompt ? [...session.messages, { role: 'user', content: nextPrompt }] : session.messages // 临时提醒只扩展本轮数组
      const messageID = Session.createMessageId()        // 每次重试使用独立的流式消息身份

      const result = await LLM.chat({                    // 请求一轮完整模型回复
        apiURL: provider.api,
        apiKey: provider.key,
        model: session.model,
        systemPrompt: store.config.prompts.system,
        messages,
        tools: definitions(),
        signal: controller.signal,
        onEvent(type, data) {
          Session.emit(sessionID, type, { messageId: messageID, ...data }) // 模型事件直接反馈给当前会话
        },
      })
      return { ...result, messageID }                    // 回复携带本次流式消息身份
    }, {
      signal: controller.signal,
      onRetry: ({ attempt, delay, error }) => Session.emit(sessionID, 'error', { message: error instanceof Error ? error.message : String(error), attempt, nextRetryIn: delay }), // 反馈重试原因和等待时间
    })
    nextPrompt = ''                                      // 临时提醒只参与紧接着的一轮

    await Session.add(sessionID, { id: answer.messageID, role: 'assistant', content: answer.contentBlocks }) // 保存完整助手回复

    if (answer.toolCalls.length === 0) {
      textOnlyCount += 1                                 // 没有行动时累计纯文本轮次
      if (textOnlyCount >= 3) return                     // 第三次普通回复后结束任务
      if (textOnlyCount === 2) nextPrompt = store.config.prompts.tool // 第二次后读取当前工具提醒
      continue                                           // 没有工具结果时继续请求 LLM
    }

    textOnlyCount = 0                                    // 工具行动后重新统计纯文本轮次
    const tools = await runAll(sessionID, answer.toolCalls) // 同一轮全部工具并行执行
    controller.signal.throwIfAborted()                   // 停止期间完成的结果不能写回会话
    const message = { id: Session.createMessageId(), role: 'tool', content: tools.results } // 工具结果组成 AI SDK 消息
    for (const toolResult of tools.results) Session.emit(sessionID, 'tool-result', { messageId: message.id, toolResult: structuredClone(toolResult) }) // 逐个反馈工具结果
    await Session.add(sessionID, message)                // 保存全部工具结果
    if (tools.shouldStop) return                         // finish 工具结束当前任务
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
  session.status = 'idle'                                // error 或残留状态恢复空闲
  await Session.save(sessionID)                          // 保存停止后的最终状态
  Session.emit(sessionID, 'status', { status: session.status }) // 反馈停止结果
  return { status: session.status }                      // 返回当前会话状态
}


export const Agent = { send, stop }                      // 导出用户可触发的发送和停止指令
