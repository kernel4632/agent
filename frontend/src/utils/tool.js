/*
 * 工具界面描述：工具脚本里的 ui 字段通过 /tool/list 来到这里。
 *
 * 工具声明标题、图标、摘要和动作；所有输入/输出使用同一个通用结果组件。
 * 前端不读取 ui.view 来分发专用渲染器，新增工具不需要修改本项目。
 * 调用示例：
 *   toolLabel(tool)                                              // '读取文件 · src/a.js'
 *   outputValue(tool)                                            // 工具结果里的真实对象
 *   outputText(tool)                                             // 工具结果转成可读文本
 *   toolStatus({ type: 'execution-denied', reason: '用户拒绝' })  // 'rejected'
 *   formatToolOutput({ type: 'text', value: 'ok' })              // 'ok'
 */

import { store } from '../store.js'
import { t } from '../utils/i18n.js'

export function uiFor(name) {
    const catalog = store.config.toolCatalog?.length ? store.config.toolCatalog : (store.config.tools || [])
    const tool = catalog.find(item => item.name === name)
    if (tool?.ui && typeof tool.ui === 'object' && !Array.isArray(tool.ui)) return tool.ui
    return {}
}

export const toolTitle = tool => uiFor(tool?.name).title || tool?.name || '工具'
export const toolIcon = tool => uiFor(tool?.name).icon || 'code'
export const toolActions = tool => {
    const actions = uiFor(tool?.name).actions
    return Array.isArray(actions) ? actions.filter(action => action && action.type && action.label) : []
}

// --- 从对象里按点路径取值：path、patches.0.path 都可以 ---
export function valueAt(value, path) {
    let current = value
    for (const key of String(path || '').split('.').filter(Boolean)) {
        if (current == null) return undefined
        current = current[key]
    }
    return current
}

// --- 把 ui.summary 里的 {path} 换成真实参数 ---
export function fillTemplate(template, input) {
    if (typeof template !== 'string') return ''
    return template.replace(/\{([^}]+)\}/g, (_, key) => {
        const value = valueAt(input, key)
        return value == null ? '' : String(value)
    }).trim()
}

// --- 行标题：工具自己给的名字 + 当前参数摘要 ---
export function toolLabel(tool) {
    const ui = uiFor(tool?.name)
    const title = ui.title || tool?.name || '工具'
    const summary = fillTemplate(ui.summary, tool?.input)
    return summary ? `${title} · ${summary}` : title
}

// --- 工具结果可能是 AI SDK 的 { type, value }，也可能是普通对象 ---
export function outputValue(tool) {
    const output = tool?.output
    if (output == null) return null
    if (typeof output !== 'object') return output
    if ('value' in output && output.type) return output.value
    return output.value ?? output
}

// --- 工具结果对应哪种状态：运行事件和历史归一化共用这一份判断 ---
// execution-denied 是用户拒绝，error-text / isError 是执行失败，其余正常结果都算完成。
export function toolStatus(output, isError = false) {
    if (isError) return 'error'
    if (output?.type === 'execution-denied') return 'rejected'
    if (output?.type === 'error-text' || output?.type === 'error-json') return 'error'
    return 'completed'
}

// --- 把工具结果转成可读文本：字符串原样，AI SDK 包装取出 value ---
export function formatToolOutput(output) {
    if (output == null) return ''
    if (typeof output === 'string') return output
    if (output.type === 'text' || output.type === 'error-text') return String(output.value ?? '')
    if (output.type === 'execution-denied') return output.reason || t('toolDenied')
    const value = output.value ?? output
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

// --- 子智能体结果里的工具步骤：递归还原成可渲染的嵌套树 ---
// 子 agent 的结论里带 steps；每个 step 的 output 还可能带下一层 steps。
export function subagentSteps(output, parentId = 'subagent', depth = 0) {
  if (depth > 4 || output == null) return []
  let payload = output
  if (payload?.type === 'json') payload = payload.value
  else if (payload?.value && typeof payload.value === 'object') payload = payload.value
  const steps = Array.isArray(payload?.steps) ? payload.steps : []
  return steps
    .filter(step => step?.type === 'tool')
    .map((step, index) => {
      const id = step.id || step.toolCallId || `${parentId}-${index}`
      const childOutput = step.output ?? null
      const status = step.status === 'error'
        ? 'error'
        : step.status === 'running'
          ? 'running'
          : toolStatus(childOutput, step.isError)
      return {
        id,
        name: step.name || step.toolName || '工具',
        input: step.input || {},
        output: childOutput,
        preview: formatToolOutput(childOutput),
        status,
        startedAt: Number(step.startedAt) || 0,
        finishedAt: Number(step.finishedAt) || 0,
        durationMs: Number(step.durationMs) || 0,
        subagentSteps: subagentSteps(childOutput, id, depth + 1),
      }
    })
}

// --- 实时子任务事件：在父工具下维护嵌套步骤，刷新后由结果里的 steps 还原 ---
export function applySubagentEvent(parent, event) {
  if (!parent) return
  if (!Array.isArray(parent.subagentSteps)) parent.subagentSteps = []
  const id = event.toolCallId || event.callID || event.callId || event.id
  if (!id) return
  let step = parent.subagentSteps.find(item => item.id === id)
  if (!step) {
    step = {
      id,
      name: event.toolName || event.tool || '工具',
      input: event.input || {},
      output: null,
      preview: '',
      status: 'running',
      startedAt: Number(event.startedAt) || Date.now(),
      finishedAt: 0,
      durationMs: 0,
      subagentSteps: [],
    }
    parent.subagentSteps.push(step)
  }
  if (event.type === 'subagent-tool-result') {
    step.output = event.output ?? event.result ?? null
    step.preview = formatToolOutput(step.output)
    step.status = event.isError || step.output?.type === 'error-text' ? 'error' : 'completed'
    step.finishedAt = Number(event.finishedAt) || Date.now()
    step.durationMs = Number(event.durationMs) || Math.max(0, step.finishedAt - (Number(step.startedAt) || step.finishedAt))
    step.subagentSteps = subagentSteps(step.output, step.id)
  }
}

// --- 工具对象的结果文本：还没结果时用流式预览兜底 ---
export function outputText(tool) {
    if (tool?.output == null) return tool?.preview || ''
    return formatToolOutput(tool.output)
}

// --- 工具声明的操作目前支持复制；交互动作统一从这里取 ---
export function actionValue(tool, action) {
    const scope = action?.from === 'output' ? outputValue(tool) : tool?.input
    return valueAt(scope, action?.value)
}

export function actionTarget(tool, action) {
    const value = actionValue(tool, action)
    return value == null ? '' : String(value)
}

// 三种状态的图标和文案只在这里定义，两个清单界面都从它派生，避免一处改了另一处没改。
export const TODO_STATUS = {
  completed: { icon: 'check', label: '已完成' },
  in_progress: { icon: 'clock', label: '进行中' },
  pending: { icon: 'info', label: '待处理' },
}

export const todoStatus = status => TODO_STATUS[status] || TODO_STATUS.pending

/** 任务清单取最近一次工具输出，主界面和工具结果共用同一来源。 */
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
