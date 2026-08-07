/*
工具审批功能：在工具执行前拦截，等待用户批准或拒绝。
所有审批等待存储在 session.approvals（Map，key 为 toolCallID）。
前端通过 SSE 收到审批请求，用户操作后调 /session/approve 触发结果。

使用示例
const decisions = await Approval.wait(session, toolCalls, signal)
Approval.answer(session, toolCallID, true)
*/
import { store } from '../store.js'                      // 引入审批配置
import { Session } from '../commands/session.js'         // 引入 SSE 事件推送


// --- 等待审批 ---
async function wait(session, toolCalls, signal) {
  const { mode, tools } = store.config.approval          // 读取当前审批配置

  const decisions = await Promise.all(toolCalls.map((toolCall) => {
    const needs = mode === 'all' || (mode === 'selected' && tools.includes(toolCall.toolName)) // 判断是否需要审批
    if (!needs) return Promise.resolve({ toolCall, approved: true }) // 不需要审批直接放行

    Session.emit(session.id, 'approval', { toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, input: toolCall.input }) // 通知前端展示审批 UI

    return new Promise((resolve) => {
      session.approvals.set(toolCall.toolCallId, { resolve: (value) => resolve({ toolCall, approved: value }) }) // 存触发器，等前端回答

      signal?.addEventListener('abort', () => {          // 用户 stop 时自动拒绝
        if (session.approvals.has(toolCall.toolCallId)) {
          session.approvals.delete(toolCall.toolCallId)  // 清除等待
          resolve({ toolCall, approved: false })         // 返回拒绝，不抛异常
        }
      }, { once: true })
    })
  }))

  return decisions
}


// --- 回答审批 ---
function answer(session, toolCallID, approved) {
  const pending = session.approvals.get(toolCallID)      // 找到等待中的触发器
  if (!pending) return                                   // 已被回答或已过期
  session.approvals.delete(toolCallID)                   // 一次性，回答后移除
  pending.resolve(approved)                              // 触发等待的 Promise
}


export const Approval = { wait, answer }
