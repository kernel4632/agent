/*
 * 判断这条会话能不能“继续助手”。
 * 只有最后一轮助手被打断、而且没有调用结束工具时才成立：
 *   - 会话已经不在运行；
 *   - 最后一轮是助手；
 *   - 这一轮没有任何结束工具（attempt_completion / ask_followup_question）；
 *   - 最后一条消息是后端真正存过的，不是本地 pending 或错误占位。
 * 调用示例：import { canContinueSession } from './continue.js'
 */
import { groupMessageTurns } from './turns.js'
import { hasStopTool } from './stop-tools.js'

const actionable = message => Boolean(message?.id) && !message.id.startsWith('pending_') && !message.id.startsWith('error_')

export function canContinueSession(session) {
  if (!session || session.status === 'running' || session.stopping) return false
  const turn = groupMessageTurns(session.messages || []).at(-1)
  if (!turn || turn.role !== 'assistant') return false
  return !hasStopTool(turn.messages) && actionable(turn.messages.at(-1))
}
