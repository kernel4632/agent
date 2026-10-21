/**
 * 把时间线消息按"轮"分组。
 *
 * 一条用户消息单独成一轮；紧跟在它后面的一条或多条助手消息合成同一轮。
 * agent-core 自动接续时，一次用户发言会产生多条 assistant 消息，它们属于同一轮，
 * 界面上只在这一轮开头显示一次头像和名字。
 *
 * 不跨用户消息合并：遇到新的用户消息就结束上一轮。
 *
 * 调用示例：
 *   import { groupMessageTurns } from './turns.js'
 *   const turns = groupMessageTurns(session.messages)
 *   // [
 *   //   { id: 'user-1', role: 'user', messages: [userMessage] },
 *   //   { id: 'assistant-1', role: 'assistant', messages: [firstReply, autoReply] },
 *   // ]
 *
 * @param {Array<{ id: string, role: string }>} messages 时间线消息，按时间从早到晚。
 * @returns {Array<{ id: string, role: string, messages: Array }>} 轮次列表。
 */
export function groupMessageTurns(messages = []) {
  const turns = []
  let assistantTurn = null // 只在连续 assistant 消息之间复用，遇到用户消息就断开。

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
