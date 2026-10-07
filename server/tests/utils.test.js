/*
 * 后端功能测试：用真实 HTTP 请求和真实数据目录走一遍主要功能，包括填错的情况。
 *
 * 每个测试在自己的临时数据目录里跑，互不影响。
 * 运行：cd server && bun test
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Agent from '@kernel4632/agent-core'

import Approval from '../features/approval.js'
import Config from '../commands/config.js'
import History from '../features/history.js'
import Session from '../commands/session.js'
import { app } from '../server.js'
import SSE from '../utils/sse.js'

// 每个测试使用独立目录，避免测试之间共享用户配置和会话历史。
const withHome = async callback => {
    const root = join(tmpdir(), `agent-server-${crypto.randomUUID()}`)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = root

    try {
        return await callback(root)
    } finally {
        if (previousHome === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previousHome
        await rm(root, { recursive: true, force: true })
    }
}

const request = (path, options = {}) => app.handle(new Request(`http://localhost${path}`, options))

const jsonRequest = (path, method, body) => request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
})

describe('server HTTP API', () => {
    test('reads and replaces configuration through HTTP', async () => {
        await withHome(async () => {
            const initial = await request('/config/read')
            expect(initial.status).toBe(200)
            expect(await initial.json()).toEqual({})

            const value = { providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'ask' } }
            const saved = await jsonRequest('/config/set', 'PATCH', value)
            expect(saved.status).toBe(200)
            expect(await saved.json()).toEqual(value)
        })
    })

    test('creates, reads, renames, and removes a session through HTTP', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }] })

            const created = await jsonRequest('/session/create', 'POST', { title: 'First task' })
            expect(created.status).toBe(200)
            const { sessionId } = await created.json()
            expect(typeof sessionId).toBe('string')

            const read = await request(`/session/read/${sessionId}`)
            expect(read.status).toBe(200)
            expect(await read.json()).toMatchObject({ id: sessionId, title: 'First task' })

            const renamed = await jsonRequest(`/session/rename/${sessionId}`, 'PATCH', { title: 'Renamed task' })
            expect(renamed.status).toBe(200)
            expect(await renamed.json()).toMatchObject({ id: sessionId, title: 'Renamed task' })

            const removed = await request(`/session/remove/${sessionId}`, { method: 'DELETE' })
            expect(removed.status).toBe(200)
            expect(await removed.json()).toEqual({ ok: true })

            const missing = await request(`/session/read/${sessionId}`)
            expect(missing.status).toBe(404)
        })
    })

    test('rejects invalid HTTP input with a client error', async () => {
        await withHome(async () => {
            const response = await jsonRequest('/session/create', 'POST', { title: '' })
            expect(response.status).toBe(400)
            expect(await response.json()).toMatchObject({ error: expect.any(String) })
        })
    })

    test('reports a missing provider as a client error instead of a server crash', async () => {
        await withHome(async () => {
            const response = await jsonRequest('/session/create', 'POST', { title: 'No provider', provider: 'missing' })
            expect(response.status).toBe(400)
            expect(await response.json()).toMatchObject({ error: expect.stringContaining('missing') })
        })
    })
})

describe('server session history', () => {
    test('rolls back and redoes messages through session commands', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }] })
            const { sessionId } = await Session.create({ title: 'History task' })

            await History.add({ sessionId, message: Agent.history.user({ content: 'one' }) })
            const second = await History.add({ sessionId, message: Agent.history.user({ content: 'two' }) })
            await History.save({ sessionId })

            const rolledBack = await Session.rollback({ sessionId, messageId: second.messageId })
            expect(rolledBack.history).toHaveLength(1)
            await Session.redo({ sessionId })
            expect((await Session.read({ sessionId })).history).toHaveLength(2)
        })
    })

    test('persists history inside the session directory', async () => {
        await withHome(async root => {
            const { sessionId } = await Session.create({ title: 'Persist task' })
            await History.add({ sessionId, message: Agent.history.user({ content: 'saved' }) })
            await History.save({ sessionId })

            const file = join(root, 'sessions', sessionId, 'history.json')
            expect(JSON.parse(await readFile(file, 'utf8')).messages).toHaveLength(1)
        })
    })

    test('keeps the session history file loadable after a round trip', async () => {
        await withHome(async () => {
            const { sessionId } = await Session.create({ title: 'Round trip' })
            await History.add({ sessionId, message: Agent.history.user({ content: 'hello' }) })
            await History.save({ sessionId })

            // 重新启动一次会话读取路径：内存里没有这台 Agent 时应当能从磁盘恢复历史。
            History.load({ sessionId })
            const reloaded = await Session.read({ sessionId })
            expect(reloaded.history.map(item => item.content)).toEqual(['hello'])
        })
    })
})

describe('server tool approval and SSE', () => {
    test('allows configured tools and returns a denial decision', async () => {
        await withHome(async () => {
            await Config.set({ permission: { '*': 'allow' } })
            expect(await Approval.check({ sessionId: 's', toolCallId: 'c1', toolName: 'shell', input: {} })).toBe(true)

            await Config.set({ permission: { '*': 'ask' } })
            const pending = Approval.check({ sessionId: 's', toolCallId: 'c2', toolName: 'shell', input: {} })
            expect(await Approval.decide({ sessionId: 's', toolCallId: 'c2', decision: 'deny' })).toEqual({ ok: true })
            expect(await pending).toBe(false)
        })
    })

    test('writes an always-allow decision back into the configuration file', async () => {
        await withHome(async () => {
            await Config.set({ permission: { '*': 'ask' } })
            const pending = Approval.check({ sessionId: 's', toolCallId: 'c3', toolName: 'file_read', input: { path: 'a.txt' } })
            await Approval.decide({ sessionId: 's', toolCallId: 'c3', decision: 'allow-always' })
            expect(await pending).toBe(true)

            // 同一条命令再次执行时规则已经命中，不再需要用户确认。
            expect(await Approval.check({ sessionId: 's', toolCallId: 'c4', toolName: 'file_read', input: { path: 'a.txt' } })).toBe(true)
        })
    })

    test('rejects an unknown decision with a client error and keeps waiting', async () => {
        await withHome(async () => {
            await Config.set({ permission: { '*': 'ask' } })
            const pending = Approval.check({ sessionId: 's', toolCallId: 'c5', toolName: 'shell', input: {} })
            await expect(Approval.decide({ sessionId: 's', toolCallId: 'c5', decision: 'maybe' })).rejects.toMatchObject({ status: 400 })

            // 填错的决定不能把这条审批弄丢，用户还能重新选一次。
            await Approval.decide({ sessionId: 's', toolCallId: 'c5', decision: 'allow-once' })
            expect(await pending).toBe(true)
        })
    })

    test('connects, sends, and closes an SSE session', async () => {
        const id = `sse-${crypto.randomUUID()}`
        const response = await SSE.connect({ id, request: new Request('http://localhost/sse') })
        const reader = response.body.getReader()
        await SSE.send({ id, data: { type: 'server-test' } })

        const first = await Promise.race([reader.read(), Bun.sleep(1000).then(() => null)])
        expect(first?.done).not.toBe(true)
        expect(new TextDecoder().decode(first.value)).toContain('server-test')
        await SSE.close({ id })
    })
})

describe('server Agent integration boundary', () => {
    test('creates a session with Agent through the package boundary', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }] })
            const { sessionId } = await Session.create({ title: 'Agent boundary' })
            const session = await Session.read({ sessionId })
            expect(session.id).toBe(sessionId)
            expect(session.history).toEqual([])
        })
    })

    test('scans the built-in tool directory together with the user tool directory', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }] })
            const { sessionId } = await Session.create({ title: 'Tool scan' })
            const agent = (await import('../store.js')).default.agents.get(sessionId)
            expect(Object.keys(agent.tools.schema)).toEqual(expect.arrayContaining(['file_read', 'shell', 'finish', 'ask']))
        })
    })
})
