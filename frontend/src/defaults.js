/*
前端首屏默认值：会话只保存思考强度，模型与压缩设置属于全局配置。
执行时的来源是 server/features/agent.js 和 server/features/config.js。
调用示例：import { DEFAULT_SETTINGS, DEFAULT_CONTEXT } from './defaults.js'
*/
export const DEFAULT_SETTINGS = {
  reasoning: 'auto',
}

// 模型没有单独设置上下文窗口时，后端按 128K 计算；界面显示也要用同一个数。
export const DEFAULT_CONTEXT = 128000
export const DEFAULT_COMPACT_THRESHOLD = 0.8

// 新会话还没有标题时显示的名字；和后端 UNTITLED 保持一致。
export const NEW_SESSION_TITLE = '新对话'

// 自动压缩阈值的可编辑范围，设置页和保存前检查共用。
export const COMPACT_RANGE = { min: 0.1, max: 0.99 }

// 压缩后保留原文的默认值：只是首屏兜底和读不到配置时的保底，真实值由 /config/read 给。
// 和 server/features/config.js 的默认值一致，方便对账。
export const DEFAULT_CONTEXT_KEEP = { firstTurns: 3, recentTurns: 3, firstShare: 0.2, recentShare: 0.3 }

// 设置页里保留轮数的上限；0 是合法值，表示这段原文一点不保留。
export const CONTEXT_KEEP_TURN_MAX = 10
