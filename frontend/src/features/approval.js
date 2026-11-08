/*
 * 工具审批：把界面上"允许 / 始终允许 / 拒绝"的决定发回后端，并维护按钮的进行中状态。
 *
 * 审批规则本身在后端；这里只负责决定的一次性提交：按钮置忙、成功后把工具推进到
 * 下一个状态。会话数据的其他改动走 features/session.js。
 *
 * 调用示例：
 *   await Approval.decide(sessionId, toolCallId, 'allow-once')
 */

import { AgentAPI } from '../utils/api.js'
import { store } from '../store.js'
import { Notice } from '../utils/notice.js'

async function decide(sessionID, callID, decision) {
  const tool = store.sessions[sessionID]?.messages.flatMap(message => message.tools || []).find(item => item.id === callID)
  if (!tool || tool.deciding || !['deny', 'allow-once', 'always-allow'].includes(decision)) return false
  tool.deciding = true
  try {
    const result = await AgentAPI.decideTool(sessionID, callID, decision === 'always-allow' ? 'allow-always' : decision)
    if (!result.ok) throw new Error('此审批已结束，请刷新会话')
    if (tool) tool.status = decision === 'deny' ? 'rejected' : 'running'
    return true
  } catch (error) { Notice.show(error.message); return false }
  finally { tool.deciding = false }
}

export const Approval = { decide }
