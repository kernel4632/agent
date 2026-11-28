/*
任务清单：工具在会话目录写下 todos.json，前端通过 op 读取，并在工具跑完后推送 todo.update。
onInject 会带上当前会话 id，这样模型调用工具时能写对地方。
*/

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** @param {import('agent-backend').Ctx['Store']} Store @param {string} id @returns {Promise<Array<{ id: string, content: string, status: string }>>} */
async function load(Store, id) {
    try { return JSON.parse(await readFile(join(Store.home(), 'agents', id, 'todos.json'), 'utf8')) } catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error)?.code === 'ENOENT') return []
        throw error
    }
}

/** @param {import('agent-backend').Ctx} ctx */
export default ctx => {
    ctx.tool(join(dirname(fileURLToPath(import.meta.url)), 'tools/todo.js'))
    ctx.op('todo.list', async (/** @type {{ id: string }} */ { id }) => ({ items: await load(ctx.Store, id) }))
    ctx.patch(ctx.Agents, 'callbacks', /** @param {(id: string) => Record<string, any>} original */ original => id => {
        const base = original(id)
        const onEvent = base.onEvent
        const onInject = base.onInject
        return {
            ...base,
            /** @param {any} event */
            onEvent(event) {
                const result = onEvent?.(event)
                if (event.type === 'tool-result' && event.result?.toolName === 'todo') {
                    void load(ctx.Store, id).then(items => ctx.push(id, 'update', { items })).catch(() => {})
                }
                return result
            },
            /** @param {unknown} info */
            async onInject(info) {
                const prior = await onInject?.(info)
                const items = await load(ctx.Store, id)
                // 会话 id 和 todo 用法只说一次：历史里还没有用户消息时注入完整说明。
                // 之后不再每轮重复指令——弱模型会把重复注入当成最新任务执行，观察实录 todo(update) 循环 11 次就是它。
                const started = ctx.Agents.get(id)?.agent.history.some(message => message.role === 'user') ?? false
                const head = started ? '' : `当前会话 id 是 ${id}。维护任务清单时调用 todo 工具并带上 agentId="${id}"。\n`
                // 空清单不注入；有清单只提一句有多少项（需要时模型自己调 todo 查看），不再全文下发。
                const pending = items.filter(item => item.status !== 'done').length
                const block = items.length
                    ? `${head}任务清单里有 ${items.length} 项（未完成 ${pending}），用 todo 工具查看或更新。`
                    : (head || '')
                return [prior, block.trim()].filter(Boolean).join('\n\n')
            },
        }
    })
}
