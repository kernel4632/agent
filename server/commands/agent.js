/*
Agent 指令集：发送消息启动循环、停止运行、批准工具执行。
Agent 操作运行时状态 store.runtime[id]，通过 Loop 驱动模型对话。
调用示例：Agent.send('session-xxx', '分析代码')、Agent.stop('session-xxx')、Agent.approve('session-xxx', 'call_abc', true)。
*/
import { store } from '../store.js'                      // 引入会话和运行时数据
import { Loop } from '../features/loop.js'               // 引入 Agent 循环引擎
import { Approval } from '../features/approval.js'       // 引入审批功能
import { Message } from '../utils/message.js'            // 引入消息工厂
import { SSE } from '../utils/sse.js'                    // 引入 SSE 广播能力
import { Session } from './session.js'                   // 引入会话保存能力


// --- 发送消息 ---
async function send(sessionID, content) {
  if (!store.sessions[sessionID]) await Session.get(sessionID) // 确保会话已加载到内存
  const session = store.sessions[sessionID]              // 直接操作 store 中的真实数据
  if (!store.runtime[sessionID]) store.runtime[sessionID] = { status: 'idle', controller: null, clients: new Set(), tools: new Set(), approvals: new Map() }
  const runtime = store.runtime[sessionID]

  const message = Message.user(content)                  // 构造用户消息
  session.messages.push(message)                         // 存入会话历史
  runtime.status = 'running'                             // 标记为运行中
  const controller = new AbortController()
  runtime.controller = controller                        // 保存停止控制器
  await Session.save(sessionID)                          // 持久化用户消息

  SSE.broadcast(runtime.clients, 'message', { message }) // 通知前端新消息
  SSE.broadcast(runtime.clients, 'status', { status: 'running' }) // 通知前端状态变更

  Loop.run({
    sessionID,
    messages: session.messages,
    model: session.model,
    signal: controller.signal,
    onEvent: (type, data) => SSE.broadcast(runtime.clients, type, data),
    onRetry: ({ attempt, delay, error }) => SSE.broadcast(runtime.clients, 'error', { message: error?.message ?? String(error), attempt, nextRetryIn: delay }),
    onReply(assistant) {
      SSE.broadcast(runtime.clients, 'message', { message: assistant })
    },
    async onTools(toolMessage, results) {
      for (const r of results) SSE.broadcast(runtime.clients, 'tool-result', { messageId: toolMessage.id, toolResult: r })
      SSE.broadcast(runtime.clients, 'message', { message: toolMessage })
      await Session.save(sessionID)
    },
  }).then(
    () => finish(sessionID),
    (error) => finish(sessionID, error),
  )

  return { messageId: message.id }
}


// --- 停止运行 ---
async function stop(sessionID) {
  const runtime = store.runtime[sessionID]
  runtime.controller?.abort(new DOMException('stopped', 'AbortError')) // 中止循环
  for (const execution of runtime.tools) execution.abort() // 中止所有工具
  await Promise.allSettled([...runtime.tools].map((e) => e.result)) // 等待工具结束
  return { status: runtime.status }
}


// --- 批准/拒绝工具 ---
function approve(sessionID, toolCallId, approved) {
  Approval.answer(store.runtime[sessionID], toolCallId, approved)
}


// --- 循环结束后收尾 ---
async function finish(sessionID, error) {
  const runtime = store.runtime[sessionID]
  const stopped = runtime.controller?.signal.aborted
  runtime.status = (error && !stopped) ? 'error' : 'idle'
  runtime.controller = null
  if (error && !stopped) SSE.broadcast(runtime.clients, 'error', { message: error?.message ?? String(error) })
  await Session.save(sessionID)
  SSE.broadcast(runtime.clients, 'status', { status: runtime.status })
}


export const Agent = { send, stop, approve }
