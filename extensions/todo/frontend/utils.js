// 工具结果里取值的辅助函数，和框架 utils/tool.js 里的 outputValue 一致
function outputValue(tool) {
    const raw = tool?.output
    if (!raw || typeof raw !== 'object') return raw
    if (raw.type === 'text' || raw.type === 'error-text') return raw.value
    if (raw.type === 'json') return raw.value
    return raw
}

// 三种状态的图标和文案
export const TODO_STATUS = {
  completed: { icon: 'check', label: '已完成' },
  in_progress: { icon: 'clock', label: '进行中' },
  pending: { icon: 'info', label: '待处理' },
}

export const todoStatus = status => TODO_STATUS[status] || TODO_STATUS.pending

// 任务清单取最近一次工具输出
export function latestTodos(messages = []) {
  for (const message of [...messages].reverse()) {
    for (const tool of [...(message.tools || [])].reverse()) {
      if (tool.name !== 'update_todo_list') continue
      const items = outputValue(tool)?.items
      if (Array.isArray(items)) return items
    }
  }
  return []
}
