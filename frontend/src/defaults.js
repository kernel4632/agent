/*
前端会用到的默认设置：新建会话、设置页显示和接口返回缺字段时共用这一份。
执行时的真正来源是 server/config/settings.js 的 defaultSettings()；这里只负责界面首屏的初始值。
调用示例：import { DEFAULT_SETTINGS, DEFAULT_CONTEXT } from './defaults.js'
*/
export const DEFAULT_SETTINGS = {
  agent: 'build',
  compactThreshold: 0.8,
  capabilities: { image: true, cache: true, stream: true },
  uses: {},
  autoTitle: true,
  reasoning: 'auto',
}

// 模型没有单独设置上下文窗口时，后端按 128K 计算；界面显示也要用同一个数。
export const DEFAULT_CONTEXT = 128000

// 新会话还没有标题时显示的名字；和后端 UNTITLED 保持一致。
export const NEW_SESSION_TITLE = '新对话'

// 自动压缩阈值的可编辑范围，设置页和保存前检查共用。
export const COMPACT_RANGE = { min: 0.1, max: 0.99 }
