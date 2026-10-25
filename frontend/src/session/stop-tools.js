/*
 * 结束工具：调用后整个 Agent 循环会停下，等用户的下一条消息。
 * 界面靠它判断一轮回复是否正常收尾；没有收尾就显示"继续助手"。
 */
import { canonicalToolName } from './tool-ui.js'

export const STOP_TOOLS = new Set(['attempt_completion', 'ask_followup_question'])

export const isStopTool = tool => STOP_TOOLS.has(canonicalToolName(tool?.name))

export const hasStopTool = messages => messages.some(message => (message.tools || []).some(isStopTool))
