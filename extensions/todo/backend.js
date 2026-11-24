/*
任务清单：工具在会话目录写下 todos.json，前端通过 op 读取，并在工具跑完后推送 todo.update。
onInject 会带上当前会话 id，这样模型调用工具时能写对地方。
*/

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** @param {import('agent-backend').Ctx['Store']} Store @param {string} id @returns {Promise<Array<{ id: string, content: string, status: string }>>} */
async function load(Store, id) {
    try { return JSON.parse(await readFile(join(Store.home(), 'agents', id, 'todos.json'), 'utf8')) } catch { return [] }
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
                    void load(ctx.Store, id).then(items => ctx.push(id, 'update', { items }))
                }
                return result
            },
            /** @param {unknown} info */
            async onInject(info) {
                const prior = await onInject?.(info)
                const items = await load(ctx.Store, id)
                const lines = items.length ? items.map(item => `- [${item.status === 'done' ? 'x' : ' '}] ${item.id} ${item.content}`).join('\n') : '（空）'
                const block = `当前会话 id 是 ${id}。维护任务清单时调用 todo 工具并带上 agentId="${id}"。\n当前清单：\n${lines}`
                return prior ? `${prior}\n\n${block}` : block
            },
        }
    })
}
