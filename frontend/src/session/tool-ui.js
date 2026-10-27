/*
 * 工具界面描述：工具脚本里的 ui 字段通过 /tool/list 来到这里。
 *
 * 工具只声明“用哪个视图、显示什么摘要、提供哪些操作”，真正的 Vue 组件放在
 * session/tools/ToolView.vue。这样旧后端或没有 ui 的自定义工具仍能退回通用行。
 * 调用示例：
 *   toolLabel(tool)                                              // '读取文件 · src/a.js'
 *   outputValue(tool)                                            // 工具结果里的真实对象
 *   outputText(tool)                                             // 工具结果转成可读文本
 *   toolStatus({ type: 'execution-denied', reason: '用户拒绝' })  // 'rejected'
 *   formatToolOutput({ type: 'text', value: 'ok' })              // 'ok'
 */

import { store } from '../store.js'
import { t } from '../i18n.js'

// 旧会话里的工具名也要能找到新工具声明的界面。
const ALIASES = {
    finish: 'attempt_completion',
    file_read: 'read_file',
    file_write: 'write_to_file',
    file_list: 'list_files',
    grep: 'search_files',
    shell: 'execute_command',
    todo: 'update_todo_list',
    ask: 'ask_followup_question',
    task: 'new_task',
}

export const canonicalToolName = name => typeof name === 'string' ? (ALIASES[name] || name) : name

export function uiFor(name) {
    const canonical = canonicalToolName(name)
    const catalog = store.config.toolCatalog?.length ? store.config.toolCatalog : (store.config.tools || [])
    const tool = catalog.find(item => item.name === canonical)
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
