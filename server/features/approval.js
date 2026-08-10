/*
工具审批功能：检查单个工具是否需要审批，需要则等待用户回答。
审批等待存储在 runtime.approvals（Map，key 为 toolCallId）。
调用示例：const allowed = await Approval.check(runtime, toolCall, signal)、Approval.answer(runtime, toolCallId, true)。
*/
import { store } from '../store.js'                      // 引入权限配置
import { SSE } from '../utils/sse.js'                    // 引入 SSE 广播能力


// --- 检查单个工具审批 ---
function check(runtime, toolCall, signal) {
  if ((store.config.permission ?? {})[toolCall.toolName] !== 'ask') return Promise.resolve(true) // 无需审批直接放行

  SSE.broadcast(runtime.clients, 'approval', { toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, input: toolCall.input }) // 通知前端

  return new Promise((resolve) => {
    runtime.approvals.set(toolCall.toolCallId, { resolve })
    signal?.addEventListener('abort', () => {
      if (runtime.approvals.has(toolCall.toolCallId)) {
        runtime.approvals.delete(toolCall.toolCallId)
        resolve(false)                                   // stop 时自动拒绝
      }
    }, { once: true })
  })
}


// --- 回答审批 ---
function answer(runtime, toolCallId, approved) {
  const pending = runtime.approvals.get(toolCallId)
  if (!pending) return
  runtime.approvals.delete(toolCallId)
  pending.resolve(approved)
}


export const Approval = { check, answer }
