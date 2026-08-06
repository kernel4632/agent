/*
Agent 指令集：接收用户消息、启动循环、停止任务。
循环引擎在 features/loop.js，本文件只负责从 store 读数据、写结果、发 SSE。
调用示例：await Agent.send(sessionID, '分析项目')、await Agent.stop(sessionID)。
*/
import createError from 'http-errors'                    // 引入标准 HTTP 错误创建
import { Loop } from '../features/loop.js'               // 引入 Agent 循环引擎
import { Message } from '../utils/message.js'            // 引入消息工厂
import { errorMessage } from '../utils/error.js'         // 引入错误消息安全提取
import { Session } from './session.js'                   // 引入会话读写和 SSE 反馈
import { run as runTools, stop as stopTools } from './tool.js' // 引入工具能力传给引擎

const runs = new WeakMap()                               // 当前停止控制器对应的完整 Agent 任务


// --- 接收用户消息 ---
async function send(sessionID, content) {
  const session = Session.get(sessionID) ?? await Session.load(sessionID)
  if (session.status !== 'idle' || session.abortController) throw createError(409, 'session is not idle')
  const message = Message.user(content)
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

  const running = Loop.run({
    messages: session.messages,
    model: session.model,
    signal: controller.signal,
    execute: (toolCalls) => runTools(sessionID, toolCalls),
    onEvent: (type, data) => Session.emit(sessionID, type, data),
    onRetry: ({ attempt, delay, error }) => Session.emit(sessionID, 'error', { message: error, attempt, nextRetryIn: delay }),
    async onReply(assistant) {
      Session.emit(sessionID, 'message', { message: structuredClone(assistant) })
    },
    async onTools(toolMessage, results) {
      for (const result of results) Session.emit(sessionID, 'tool-result', { messageId: toolMessage.id, toolResult: structuredClone(result) })
      Session.emit(sessionID, 'message', { message: structuredClone(toolMessage) })
      await Session.save(sessionID)
    },
  }).then(
    () => finish(session, controller),
    (error) => finish(session, controller, error),
  ).finally(() => runs.delete(controller))
  runs.set(controller, running)
  return { messageId: message.id }
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
