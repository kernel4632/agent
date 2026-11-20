/*
当前会话的任务清单。必须带上 agentId（当前会话 id，提示词里会给出）。
清单写在该会话目录的 todos.json。
*/

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

function path(agentId) {
    const home = process.env.AGENT_HOME || join(homedir(), '.agent')
    return join(home, 'agents', agentId, 'todos.json')
}

async function load(agentId) {
    try { return JSON.parse(await readFile(path(agentId), 'utf8')) } catch { return [] }
}

async function save(agentId, items) {
    await mkdir(join(path(agentId), '..'), { recursive: true })
    await writeFile(path(agentId), JSON.stringify(items, null, 2) + '\n')
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
    async run({ agentId, action, id, content, status } = {}) {
        if (!agentId) throw new Error('需要 agentId（当前会话 id）')
        const items = await load(agentId)
        if (action === 'list') return { items }
        if (action === 'add') {
            if (!content) throw new Error('content 不能为空')
            items.push({ id: `t${Date.now().toString(36)}`, content, status: 'pending' })
            return { items: await save(agentId, items) }
        }
        if (action === 'complete' || action === 'update') {
            const item = items.find(one => one.id === id)
            if (!item) throw new Error(`找不到任务 ${id}`)
            if (action === 'complete') item.status = 'done'
            if (content) item.content = content
            if (status) item.status = status
            return { items: await save(agentId, items) }
        }
        if (action === 'clear') return { items: await save(agentId, []) }
        throw new Error(`不认识的 action：${action}`)
    },
}
