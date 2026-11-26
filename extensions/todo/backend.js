/*
 * todo 扩展后端：注册 update_todo_list 工具，patch Tool.kind/list 补充元数据。
 *
 * 这个文件在 server.js 启动时被 Extension.load() 调用。
 * 通过 ctx 修改框架，加载器记录每一处改动，拔出扩展时逐条恢复。
 */

import tool from './tool.js'
import History from '@agent/features/history.js'
import Tool from '@agent/features/tool.js'
import fail from '@agent/utils/fail.js'

// --- 从会话历史里取最后一次 update_todo_list 的结构化条目 ---
const latestTodos = async sessionId => {
    if (!sessionId) throw fail(400, 'sessionId is required')
    await History.load(sessionId)
    const messages = History.get({ sessionId })
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const content = messages[i]?.content
        if (!Array.isArray(content)) continue
        for (let j = content.length - 1; j >= 0; j -= 1) {
            const part = content[j]
            if (part?.type !== 'tool-result' || part.toolName !== 'update_todo_list') continue
            const value = part.output?.type === 'json' ? part.output.value : part.output
            if (Array.isArray(value?.items)) return { items: value.items }
        }
    }
    return { items: [] }
}

export default ctx => {
    // --- patch Tool.build：注入 update_todo_list 工具 ---
    ctx.patch(Tool, 'build', original => async args => {
        const result = await original(args)
        result.tools = Tool.merge(result.tools, Tool.adopt([tool]))
        return result
    })

    // --- patch Tool.kind：update_todo_list 属于 never 类别，不需要审批 ---
    ctx.patch(Tool, 'kind', original => args => {
        if (args.toolName === 'update_todo_list') return 'never'
        return original(args)
    })

    // --- patch Tool.list：补充 update_todo_list 的 UI 元数据 ---
    ctx.patch(Tool, 'list', original => async () => {
        const tools = await original()
        return tools.map(item => item.name === 'update_todo_list' ? {
            ...item,
            ui: { view: 'todo', icon: 'check', title: '任务清单', summary: '当前进度' }
        } : item)
    })

    ctx.op('todo.list', ({ sessionId } = {}) => latestTodos(sessionId))
}
