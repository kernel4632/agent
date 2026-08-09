/*
工具审批功能：工具执行前等待用户批准或拒绝。
审批等待存储在 runtime.approvals（Map，key 为 toolCallId）。
调用示例：const decisions = await Approval.wait(runtime, toolCalls, signal)、Approval.answer(runtime, toolCallId, true)。
*/
import { store } from '../store.js'                      // 引入权限配置
import { SSE } from '../utils/sse.js'                    // 引入 SSE 广播能力


// --- 等待审批 ---
async function wait(runtime, toolCalls, signal) {
  return Promise.all(toolCalls.map((toolCall) => {
    if (store.config.permission[toolCall.toolName] !== 'ask') return { toolCall, approved: true } // 不需要审批的直接放行

    SSE.broadcast(runtime.clients, 'approval', { toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, input: toolCall.input }) // 通知前端展示审批 UI

    return new Promise((resolve) => {
      runtime.approvals.set(toolCall.toolCallId, { resolve: (value) => resolve({ toolCall, approved: value }) }) // 存触发器等前端回答
      signal?.addEventListener('abort', () => {
        if (runtime.approvals.has(toolCall.toolCallId)) {
          runtime.approvals.delete(toolCall.toolCallId)
          resolve({ toolCall, approved: false })         // stop 时自动拒绝
        }
      }, { once: true })
    })
  }))
}


// --- 回答审批 ---
function answer(runtime, toolCallId, approved) {
  const pending = runtime.approvals.get(toolCallId)
  if (!pending) return
  runtime.approvals.delete(toolCallId)
  pending.resolve(approved)
}


export const Approval = { wait, answer }
