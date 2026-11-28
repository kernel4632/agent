/*
当前会话的任务清单。必须带上 agentId（当前会话 id，提示词里会给出）。
清单写在该会话目录的 todos.json。
*/

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** @typedef {{ id: string, content: string, status: 'pending' | 'done' }} TodoItem */

/** @type {Map<string, Promise<unknown>>} */
const queues = new Map()

/** @template T @param {string} id @param {() => Promise<T>} work @returns {Promise<T>} */
function enqueue(id, work) {
    const next = (queues.get(id) ?? Promise.resolve()).then(work, work)
    queues.set(id, next.catch(() => {}))
    return next
}

/** @param {string} agentId */
function path(agentId) {
    const home = process.env.AGENT_HOME || join(homedir(), '.agent')
    return join(home, 'agents', agentId, 'todos.json')
}

/** @param {string} agentId @returns {Promise<TodoItem[]>} */
async function load(agentId) {
    try { return JSON.parse(await readFile(path(agentId), 'utf8')) } catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error)?.code === 'ENOENT') return []
        throw error
    }
}

// 先写临时文件再改名，避免中断时留下半份 JSON，同时防止读取方读到写了一半的内容。
/** @param {string} agentId @param {TodoItem[]} items */
async function save(agentId, items) {
    const file = path(agentId)
    await mkdir(join(file, '..'), { recursive: true })
    const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    await writeFile(temp, JSON.stringify(items, null, 2) + '\n')
    await rename(temp, file)
    return items
}

export default {
    name: 'todo',
    description: [
        '维护当前会话的任务清单。每次调用都必须带上 agentId（当前会话 id，见系统提示）。',
        'action：list 查看；add 新增（content）；update 改一条（id、content、status）；complete 完成（id）；clear 清空。',
        'status 为 pending / done。',
    ].join('\n'),
    parameters: {
        type: 'object',
        properties: {
            agentId: { type: 'string', description: '当前会话 id' },
            action: { type: 'string', enum: ['list', 'add', 'update', 'complete', 'clear'] },
            id: { type: 'string' },
            content: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'done'] },
        },
        required: ['agentId', 'action'],
    },
    /** @param {{ agentId?: string, action?: string, id?: string, content?: string, status?: string }} [args] */
    run({ agentId, action, id, content, status } = {}) {
        if (!agentId) return Promise.reject(new Error('需要 agentId（当前会话 id）'))
        return enqueue(agentId, async () => {
            /** @type {TodoItem[]} */
            const items = await load(agentId)
            if (action === 'list') return { items }
            if (action === 'add') {
                if (!content) throw new Error('content 不能为空')
                let nextId = `t${Date.now().toString(36)}`
                while (items.some(one => one.id === nextId)) nextId = `${nextId}x`
                items.push({ id: nextId, content, status: 'pending' })
                return { items: await save(agentId, items) }
            }
            if (action === 'complete' || action === 'update') {
                const item = items.find(one => one.id === id)
                if (!item) throw new Error(`找不到任务 ${id}`)
                if (action === 'complete') item.status = 'done'
                if (content) item.content = content
                if (status) item.status = /** @type {TodoItem['status']} */ (status)
                return { items: await save(agentId, items) }
            }
            if (action === 'clear') return { items: await save(agentId, []) }
            throw new Error(`不认识的 action：${action}`)
        })
    },
}
