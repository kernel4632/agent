/*
Agent 指令集：接收用户消息、运行完整 Agent 循环，并停止当前任务。
run() 从上到下完整展示"请求 LLM、保存回复、执行工具、带结果继续请求、结束任务"的全部过程。
调用示例：await Agent.send(sessionID, '分析项目')、await Agent.stop(sessionID)。
*/
import createError from 'http-errors'                    // 引入标准 HTTP 错误创建
import { LLM } from '../utils/llm.js'                    // 引入完整单轮 LLM 请求能力
import { Message } from '../utils/message.js'            // 引入消息工厂
import { Retry } from '../utils/retry.js'                // 引入可中断的无限重试能力
import { errorMessage } from '../utils/error.js'         // 引入错误消息安全提取
import { store } from '../store.js'                      // 引入模型供应商配置
import { Session } from './session.js'                   // 引入会话读写和 SSE 反馈
import { list as listTools, run as runTools, stop as stopTools } from './tool.js' // 引入工具定义、运行和停止能力

const runs = new WeakMap()                               // 当前停止控制器对应的完整 Agent 任务


// --- 接收用户消息 ---
async function send(sessionID, content) {
  const session = Session.get(sessionID) ?? await Session.load(sessionID)
  if (session.status !== 'idle' || session.abortController) throw createError(409, 'session is not idle')
  const message = Message.user(content)                  // 用户消息由工厂统一创建
  session.messages.push(message)
  session.status = 'running'
  const controller = new AbortController()
  session.abortController = controller

  try { await Session.save(sessionID) }
  catch (error) {
    session.status = 'error'
    session.abortController = null
    Session.emit(sessionID, 'error', { message: errorMessage(error) })
    Session.emit(sessionID, 'status', { status: session.status })
    throw error
  }
  Session.emit(sessionID, 'message', { message: structuredClone(message) })
  Session.emit(sessionID, 'status', { status: 'running' })

  const running = run(session, controller).then(
    () => finish(session, controller),
    (error) => finish(session, controller, error),
  ).finally(() => runs.delete(controller))
  runs.set(controller, running)
  return { messageId: message.id }
}


// --- 运行完整 Agent 循环 ---
async function run(session, controller) {
  const sessionID = session.id
  let nextPrompt = ''
  let textOnlyCount = 0

  while (!controller.signal.aborted) {
    const answer = await Retry.run(async () => {
      const provider = store.config.provider
      const messages = nextPrompt ? [...session.messages, { role: 'user', content: nextPrompt }] : session.messages
      const messageID = Message.id()                     // 每次重试使用独立的流式消息身份

      const result = await LLM.chat({
        apiURL: provider.api,
        apiKey: provider.key,
        model: session.model,
        systemPrompt: store.config.prompts.system,
        messages,
        tools: listTools(),
        signal: controller.signal,
        onEvent(type, data) {
          Session.emit(sessionID, type, { messageId: messageID, ...data })
        },
      })
      return { ...result, messageID }
    }, {
      signal: controller.signal,
      onRetry: ({ attempt, delay, error }) => Session.emit(sessionID, 'error', { message: errorMessage(error), attempt, nextRetryIn: delay }),
    })
    nextPrompt = ''

    const assistant = Message.assistant(answer.contentBlocks) // 助手消息由工厂创建
    assistant.id = answer.messageID                       // 使用流式阶段已经广播的消息 ID
    session.messages.push(assistant)
    Session.emit(sessionID, 'message', { message: structuredClone(assistant) })
    await Session.save(sessionID)

    if (answer.toolCalls.length === 0) {
      textOnlyCount += 1
      if (textOnlyCount >= 3) return
      if (textOnlyCount === 2) nextPrompt = store.config.prompts.tool
      continue
    }

    textOnlyCount = 0
    const tools = await runTools(sessionID, answer.toolCalls)
    const toolMessage = Message.tool(tools.results)      // 工具消息由工厂创建
    for (const toolResult of tools.results) Session.emit(sessionID, 'tool-result', { messageId: toolMessage.id, toolResult: structuredClone(toolResult) })
    session.messages.push(toolMessage)
    Session.emit(sessionID, 'message', { message: structuredClone(toolMessage) })
    await Session.save(sessionID)
    if (tools.shouldStop) return
  }
}


// --- 完成当前任务 ---
async function finish(session, controller, error) {
  const stopped = controller.signal.aborted || error?.name === 'AbortError'
  session.status = error && !stopped ? 'error' : 'idle'
  if (error && !stopped) Session.emit(session.id, 'error', { message: errorMessage(error) })
  try { await Session.save(session.id) }
  catch (saveError) {
    session.status = 'error'
    Session.emit(session.id, 'error', { message: errorMessage(saveError) })
  }
  if (session.abortController === controller) session.abortController = null
  Session.emit(session.id, 'status', { status: session.status })
}


// --- 停止当前任务 ---
async function stop(sessionID) {
  const session = Session.get(sessionID) ?? await Session.load(sessionID)
  const controller = session.abortController
  const running = controller && runs.get(controller)

  controller?.abort(new DOMException('stopped by user', 'AbortError'))
  await stopTools(sessionID)
  if (running) {
    await running.catch(() => {})
    if (session.abortController && session.abortController !== controller) return { status: session.status }
    return { status: session.status }
  }

  session.abortController = null
  session.status = 'idle'
  await Session.save(sessionID)
  Session.emit(sessionID, 'status', { status: session.status })
  return { status: session.status }
}


export const Agent = { send, stop }
