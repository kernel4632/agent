/*
工具审批指令：登记 Run 的工具等待点，并处理拒绝、单次允许和永久允许决定。
审批状态只按 Run 与工具调用定位；Session 归属在恢复执行前再次校验。
调用示例：await Approval.wait({...})、await Approval.decide({...})。
*/
import { Config } from './config.js'                    // 引入永久允许规则的持久化动作
import { Run } from './run.js'                          // 引入审批等待和恢复状态转换

const pendingApprovals = new Map()                      // Run 与 toolCallID 组合键到一次性审批等待项


// --- 创建审批组合键 ---
function createKey(runID, toolCallID) {
  return `${runID}\u0000${toolCallID}`                  // 不可见分隔符避免普通 ID 拼接碰撞
}


// --- 等待用户批准工具 ---
function wait({ runID, sessionID, toolCallID, toolName, input, matched, emit, abortSignal }) {
  Run.markWaitingApproval(runID)                        // 工具等待用户决定时公开准确的 Run 状态
  return new Promise((resolve) => {
    const key = createKey(runID, toolCallID)            // 同一会话的不同 Run 保持审批隔离
    let finished = false                                // 审批、拒绝和中断只能恢复一次
    const finish = (decision) => {
      if (finished) return                              // 竞争到达的第二个结果不能重复恢复模型
      finished = true                                   // 首个决定取得当前等待点
      pendingApprovals.delete(key)                      // 移除一次性等待项
      abortSignal.removeEventListener('abort', abortWait) // 审批完成后释放中断监听
      Run.resume(runID)                                 // 决定完成后恢复仍在等待的 Run
      resolve(decision)                                 // 将三选一决定反馈给工具执行
    }
    const abortWait = () => finish('deny')              // 停止 Run 时按拒绝恢复，不留下挂起 Promise
    pendingApprovals.set(key, { runID, sessionID, toolCallID, toolName, finish, deciding: false }) // 保存定位和持久化需要的业务数据
    abortSignal.addEventListener('abort', abortWait, { once: true }) // 审批等待响应用户停止和请求断开
    if (abortSignal.aborted) return abortWait()          // 已中断 Run 不能进入永久等待
    emit('tool-approval-request', { id: toolCallID, runID, name: toolName, args: input, matchedRule: matched.rule, scope: matched.scope, target: matched.target }) // 将审批内容和 Run 归属反馈客户端
  })
}


// --- 查找一个明确的待审批工具调用 ---
function find(sessionID, toolCallID, runID) {
  if (runID) {
    const pending = pendingApprovals.get(createKey(runID, toolCallID)) // 新入口按 Run 精确定位
    return pending?.sessionID === sessionID ? { pending } : {}         // Session 不匹配时拒绝跨会话恢复
  }
  const matches = [...pendingApprovals.values()].filter((item) => item.sessionID === sessionID && item.toolCallID === toolCallID) // 兼容入口按会话查找
  if (matches.length > 1) return { ambiguous: true }                    // 多个子 Run 重名时必须要求精确 Run ID
  return { pending: matches[0] }                                        // 零个或唯一匹配交给决定动作处理
}


// --- 处理一次工具审批决定 ---
async function decide({ sessionID, toolCallID, decision, runID }) {
  const found = find(sessionID, toolCallID, runID)                       // 先验证 Run、Session 和工具调用归属
  if (found.ambiguous) return { ok: false, status: 409, error: 'multiple tool calls match; runId is required' } // 拒绝模糊审批
  const pending = found.pending                                           // 读取唯一等待项
  if (!pending || pending.deciding) return { ok: false, status: 404, error: 'tool call is not waiting for approval' } // 一次审批只能消费一次

  pending.deciding = true                                                // 持久化期间阻止第二个决定竞争
  try {
    if (decision === 'always-allow') await Config.allowTool(pending.toolName) // 永久允许先写盘再恢复真实执行
    pending.finish(decision)                                             // 恢复工具等待和模型循环
    return { ok: true, decision }                                        // 反馈实际生效的审批选择
  } catch (error) {
    pending.deciding = false                                             // 写盘失败保留等待项供用户重试
    return { ok: false, status: 500, error: `failed to persist permission: ${error.message}` } // 明确反馈未执行工具
  }
}


export const Approval = { wait, decide }                                 // 暴露审批等待和决定两个业务动作
