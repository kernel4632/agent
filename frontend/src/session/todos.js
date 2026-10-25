/*
 * 从消息里取最新一份任务清单。
 * 工具结果里的 items 是唯一数据源；会话列表和输入框上方都用它。
 */
import { canonicalToolName, outputValue } from './tool-ui.js'

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
