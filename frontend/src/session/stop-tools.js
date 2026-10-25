/*
 * 结束工具：调用后整个 Agent 循环会停下，等用户的下一条消息。
 * 只有真正完成并带回结果的结束工具才算收尾；失败或被拒绝仍按普通工具步骤显示，继续按钮也还会出现。
 * 调用示例：
 *   isFinishedStopTool(tool)      // true 时结果直接成为助手回复
 *   hasStopTool(turn.messages)    // false 时时间线提供“继续助手”
 */
import { canonicalToolName, outputText, toolStatus } from './tool-ui.js'

export const STOP_TOOLS = new Set(['attempt_completion', 'ask_followup_question'])

export const isStopTool = tool => STOP_TOOLS.has(canonicalToolName(tool?.name))

// 状态、输出内容、输出文本都从 tool-ui 来；被拒绝或执行失败的任务不会被当成正常收尾。
export const isFinishedStopTool = tool => isStopTool(tool)
  && tool.status === 'completed'
  && toolStatus(tool.output) === 'completed'
  && Boolean(outputText(tool))

export const hasStopTool = messages => messages.some(message => (message.tools || []).some(isFinishedStopTool))
