/*
 * 任务清单：从消息里取最新一份，并给三种状态配同一套图标和文案。
 * 工具结果里的 items 是唯一数据源；输入框上方和任务清单工具视图都从这里取值。
 * 调用示例：
 *   const items = latestTodos(session.messages)        // [{ text, status }]
 *   TODO_STATUS.in_progress.label                      // '进行中'
 *   TODO_STATUS.completed.icon                        // 'check'
 */
import { canonicalToolName, outputValue } from './tool-ui.js'

// 三种状态的图标和文案只在这里定义，两个清单界面都从它派生，避免一处改了另一处没改。
export const TODO_STATUS = {
  completed: { icon: 'check', label: '已完成' },
  in_progress: { icon: 'clock', label: '进行中' },
  pending: { icon: 'info', label: '待处理' },
}

export const todoStatus = status => TODO_STATUS[status] || TODO_STATUS.pending

export function latestTodos(messages = []) {
  for (const message of [...messages].reverse()) {
    for (const tool of [...(message.tools || [])].reverse()) {
      if (canonicalToolName(tool.name) !== 'update_todo_list') continue
      const items = outputValue(tool)?.items
      if (Array.isArray(items)) return items
    }
  }
  return []
}
