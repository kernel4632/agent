/*
 * 时间线轮次：把消息列表按用户消息划分轮次，并判断一轮是否还能继续。
 *
 * 这些判断同时被时间线、定位条和继续按钮使用；只做判断，不发请求。
 * 结束工具（attempt_completion / ask_followup_question）完成才算一轮收尾。
 *
 * 调用示例：
 *   const turns = groupMessageTurns(session.messages)
 *   const canContinue = canContinueSession(session)
 */

import { toolStatus, outputText } from '../utils/tool.js'

// 结束工具名单：这两个工具的完成结果就是一轮的正式回复。
export const STOP_TOOLS = new Set(['attempt_completion', 'ask_followup_question'])

export const isStopTool = tool => STOP_TOOLS.has(tool?.name)

// 状态、输出内容、输出文本都从 tool-ui 来；被拒绝或执行失败的任务不会被当成正常收尾。
export const isFinishedStopTool = tool => isStopTool(tool)
  && tool.status === 'completed'
  && toolStatus(tool.output) === 'completed'
  && Boolean(outputText(tool))

export const hasStopTool = messages => messages.some(message => (message.tools || []).some(isFinishedStopTool))

// 本地占位（pending）和错误气泡没有后端消息 id，不能回退、分支或继续。
export const isSavedMessage = message => Boolean(message?.id) && !message.id.startsWith('pending_') && !message.id.startsWith('error_')

/** 按用户消息划分轮次；自动接续的助手消息属于同一轮。 */
export function groupMessageTurns(messages = []) {
  const turns = []
  let assistantTurn = null
  for (const message of messages) {
    if (message.role === 'assistant' && assistantTurn) {
      assistantTurn.messages.push(message)
      continue
    }
    const turn = { id: message.id, role: message.role, messages: [message] }
    turns.push(turn)
    assistantTurn = message.role === 'assistant' ? turn : null
  }
  return turns
}

/**
 * 已经落盘、没有正常收尾的最后一轮可以继续。
 * 末尾是用户消息时也允许：模型在返回前被打断，宿主会用内部提示重新请求，
 * 用户不需要回退重发。
 */
export function canContinueSession(session) {
  if (!session || session.status === 'running' || session.stopping) return false
  const turn = groupMessageTurns(session.messages || []).at(-1)
  if (!turn) return false
  if (turn.role === 'user') return isSavedMessage(turn.messages.at(-1))
  if (turn.role !== 'assistant') return false
  // 本地 error 气泡没有后端 id，但它前面可能已经有落盘的助手进度；
  // 运行停止后只要这一轮没有正常收尾，就应该给“继续”，不能被错误气泡挡住。
  const saved = [...turn.messages].reverse().find(isSavedMessage)
  if (!saved) return false
  return !hasStopTool(turn.messages)
}
