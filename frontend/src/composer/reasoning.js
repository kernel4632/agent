/*
思考强度的七档定义：滑块顺序、中文名、图标和一句说明都在这里。
只负责界面展示；真正发给模型的参数由后端 commands/config.js 按协议翻译。
调用示例：import { REASONING_LEVELS, reasoningOf } from './reasoning.js'
*/
export const REASONING_LEVELS = [
  { value: 'off', label: '关闭', short: '关', icon: 'thinking-off', hint: '不请求模型思考，回答最快' },
  { value: 'auto', label: '自动', short: '自动', icon: 'thinking-auto', hint: '不额外设置，交给模型自己决定' },
  { value: 'low', label: '轻', short: '轻', icon: 'thinking-low', hint: '适合简单问题，少花一点时间' },
  { value: 'medium', label: '中', short: '中', icon: 'thinking-medium', hint: '日常任务的默认档位' },
  { value: 'high', label: '重', short: '重', icon: 'thinking-high', hint: '复杂问题，允许更长的推理' },
  { value: 'xhigh', label: '极高', short: '极高', icon: 'thinking-xhigh', hint: '长链路任务，思考预算更大' },
  { value: 'max', label: '最大', short: '最大', icon: 'thinking-max', hint: '最慢，也最深入；只留给真正难的问题' },
]

// 找不到时回到 auto，避免旧数据或拼错的值把滑块卡在 0。
export const reasoningOf = value => REASONING_LEVELS.find(item => item.value === value) || REASONING_LEVELS[1]
export const reasoningIndex = value => Math.max(0, REASONING_LEVELS.findIndex(item => item.value === value))
