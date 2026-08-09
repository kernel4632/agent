/*
Agent 指令集：发送消息启动循环、停止运行、批准工具执行。
Agent 操作运行时状态 store.runtime[id]，通过 Loop 驱动模型对话。
调用示例：Agent.send('session-xxx', '分析代码')、Agent.stop('session-xxx')、Agent.approve('session-xxx', 'call_abc', true)。
*/
import { store } from '../store.js'                      // 引入会话和运行时数据
import { Loop } from '../features/loop.js'               // 引入 Agent 循环引擎
import { Approval } from '../features/approval.js'       // 引入审批功能
import { Message } from '../utils/message.js'            // 引入消息工厂
import { Tool } from '../utils/tool.js'                  // 引入工具执行能力
import { SSE } from '../utils/sse.js'                    // 引入 SSE 广播能力
import { Session } from './session.js'                   // 引入会话保存能力


// --- 确保运行时存在 ---
function ensureRuntime(id) {
  if (!store.runtime[id]) store.runtime[id] = { status: 'idle', controller: null, clients: new Set(), tools: new Set(), approvals: new Map() }
  return store.runtime[id]
}


// --- 发送消息 ---
async function send(sessionID, content) {
  if (!store.sessions[sessionID]) await Session.get(sessionID)
  const session = store.sessions[sessionID]
  const runtime = ensureRuntime(sessionID)

  const message = Message.user(content)                  // 构造用户消息
  session.messages.push(message)                         // 存入会话历史
  runtime.status = 'running'
  const controller = new AbortController()
  runtime.controller = controller
  await Session.save(sessionID)                          // 持久化用户消息

  SSE.broadcast(runtime.clients, 'message', { message })
  SSE.broadcast(runtime.clients, 'status', { status: 'running' })

  Loop.run({
    messages: session.messages,
    model: session.model,
    signal: controller.signal,
    execute: (toolCalls) => Promise.all(toolCalls.map(async (toolCall) => {
      const allowed = await Approval.check(runtime, toolCall, controller.signal) // 审批
      if (!allowed) return { result: Message.result(toolCall, '用户拒绝执行该工具', true), stop: false }
      const execution = Tool.execute(toolCall.toolName, toolCall.input, {
        onOutput: (chunk) => SSE.broadcast(runtime.clients, 'tool-output', { toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, output: chunk }),
      })
      runtime.tools.add(execution)
      const value = await execution.result
      runtime.tools.delete(execution)
      return { result: Message.result(toolCall, value.output, value.isError), stop: value.stop }
    })),
    onEvent: (type, data) => SSE.broadcast(runtime.clients, type, data),
    onRetry: ({ attempt, delay, error }) => SSE.broadcast(runtime.clients, 'error', { message: error, attempt, nextRetryIn: delay }),
    onReply(assistant) {
      SSE.broadcast(runtime.clients, 'message', { message: assistant })
    },
    async onTools(toolMessage, results) {
      for (const r of results) SSE.broadcast(runtime.clients, 'tool-result', { messageId: toolMessage.id, toolResult: r })
      SSE.broadcast(runtime.clients, 'message', { message: toolMessage })
      await Session.save(sessionID)
    },
  }).then(
    async () => {
      runtime.status = 'idle'
      runtime.controller = null
      await Session.save(sessionID)
      SSE.broadcast(runtime.clients, 'status', { status: 'idle' })
    },
    async (error) => {
      const stopped = controller.signal.aborted
      runtime.status = (error && !stopped) ? 'error' : 'idle'
      runtime.controller = null
      if (error && !stopped) SSE.broadcast(runtime.clients, 'error', { message: error?.message ?? String(error) })
      await Session.save(sessionID)
      SSE.broadcast(runtime.clients, 'status', { status: runtime.status })
    },
  )

  return { messageId: message.id }
}


// --- 停止运行 ---
async function stop(sessionID) {
  const runtime = store.runtime[sessionID]
  runtime.controller?.abort(new DOMException('stopped', 'AbortError'))
  for (const execution of runtime.tools) execution.abort()
  await Promise.allSettled([...runtime.tools].map((e) => e.result))
  return { status: runtime.status }
}


// --- 批准/拒绝工具 ---
function approve(sessionID, toolCallId, approved) {
  Approval.answer(store.runtime[sessionID], toolCallId, approved)
}


export const Agent = { send, stop, approve }
