/*
 * 结束工具：调用后整个 Agent 循环会停下，等用户的下一条消息。
 * 只有真正完成并带回结果的结束工具才算收尾；失败或空结果仍按普通工具步骤显示。
 */
import { canonicalToolName, outputText } from './tool-ui.js'

export const STOP_TOOLS = new Set(['attempt_completion', 'ask_followup_question'])

export const isStopTool = tool => STOP_TOOLS.has(canonicalToolName(tool?.name))

export const isFinishedStopTool = tool => isStopTool(tool) && tool.status === 'completed' && Boolean(outputText(tool))

export const hasStopTool = messages => messages.some(message => (message.tools || []).some(isFinishedStopTool))
