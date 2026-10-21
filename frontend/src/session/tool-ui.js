/*
 * 工具界面描述：工具脚本里的 ui 字段通过 /tool/list 来到这里。
 *
 * 工具只声明“用哪个视图、显示什么摘要、提供哪些操作”，真正的 Vue 组件放在
 * session/tools/ToolView.vue。这样旧后端或没有 ui 的自定义工具仍能退回通用行。
 * 调用示例：
 *   toolLabel(tool)       // '读取文件 · src/a.js'
 *   outputValue(tool)     // 工具结果里的真实对象
 */

import { store } from '../store.js'

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

// new_task 是在会话装配时临时加进去的，不在 tools/ 目录扫描结果里，给它一份兜底描述。
const NEW_TASK_UI = {
    view: 'subtask',
    icon: 'branch',
    title: '创建子任务',
    summary: '{description}',
}

export const canonicalToolName = name => typeof name === 'string' ? (ALIASES[name] || name) : name

export function uiFor(name) {
    const canonical = canonicalToolName(name)
    const catalog = store.config.toolCatalog?.length ? store.config.toolCatalog : (store.config.tools || [])
    const tool = catalog.find(item => item.name === canonical)
    if (tool?.ui && typeof tool.ui === 'object' && !Array.isArray(tool.ui)) return tool.ui
    if (canonical === 'new_task') return NEW_TASK_UI
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

export function outputText(tool) {
    const value = outputValue(tool)
    if (typeof value === 'string') return value
    if (value == null) return tool?.preview || ''
    return JSON.stringify(value, null, 2)
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
