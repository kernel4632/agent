/*
 * 后端功能测试：用真实 HTTP 请求和真实数据目录走一遍主要功能，包括填错的情况。
 *
 * 每个测试在自己的临时数据目录里跑，互不影响。
 * 运行：cd server && bun test
 */
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import AgentCore from '@kernel4632/agent-core'
import Approval from '../features/approval.js'
import Path from '../utils/path.js'
import Agent from '../features/agent.js'
import Settings from '../commands/settings.js'
import * as File from '../tools/file.js'
import History from '../features/history.js'
import Mcp from '../features/mcp.js'
import SkillsFeature from '../features/skills.js'
import Session from '../commands/session.js'
import Skill from '../tools/skill.js'
import store from '../store.js'
import { app } from '../server.js'
import SSE from '../utils/sse.js'
import usageOf from '../utils/usage.js'

// 每个测试使用独立目录和干净的内存数据，避免测试之间互相影响。
const withHome = async callback => {
    const root = join(tmpdir(), `agent-server-${crypto.randomUUID()}`)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    Path.lock(root)   // 锁定数据目录：晚到的异步收尾不会落到真实 ~/.agent
    Object.keys(store.config).forEach(key => delete store.config[key])
    Agent.runtime().clear()
    History.clear()

    try {
        return await callback(root)
    } finally {
        Path.unlock()
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
            expect(await initial.json()).toMatchObject({
                prompt: { system: expect.any(String), seeded: true },
                models: { chat: expect.any(Object), compact: expect.any(Object) },
            })

            const value = { providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }], permission: { '*': 'ask' } }
            const saved = await jsonRequest('/config/set', 'PATCH', value)
            expect(saved.status).toBe(200)
            expect(await saved.json()).toMatchObject({
                permission: { '*': 'ask' },
                models: { chat: { provider: '', model: '' } },
            })
        })
    })

    test('creates, reads, renames, moves and removes a session through HTTP', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }] })

            const created = await jsonRequest('/session/create', 'POST', { title: 'First task' })
            expect(created.status).toBe(200)
            const { sessionId } = await created.json()

            // historyLimit 只返回最近一页，并给出完整历史里的起始下标。
            for (const content of ['one', 'two', 'three']) {
                await History.add({ sessionId, message: { role: 'user', content } })
            }
            await History.save(sessionId)
            const windowedResponse = await request(`/session/read/${sessionId}?historyLimit=2`)
            expect(windowedResponse.status).toBe(200)
            const windowed = await windowedResponse.json()
            expect(windowed).toMatchObject({ historyStart: 1, historyTotal: 3 })
            expect(windowed.history).toHaveLength(2)

            const fromStart = await (await request(`/session/read/${sessionId}?historyStart=1`)).json()
            expect(fromStart).toMatchObject({ historyStart: 1, historyTotal: 3 })
            expect(fromStart.history).toHaveLength(2)

            const searched = await (await request(`/session/search/${sessionId}?q=two`)).json()
            expect(searched.results).toHaveLength(1)
            expect(searched.results[0]).toMatchObject({ id: expect.any(String), index: 1, match: 'two' })

            const read = await request(`/session/read/${sessionId}`)
            expect(read.status).toBe(200)
            const session = await read.json()
            expect(session).toMatchObject({ id: sessionId, title: 'First task', temporary: true })
            expect(session.cwd).not.toBe(process.cwd())
            expect((await stat(session.cwd)).isDirectory()).toBe(true)

            const renamed = await jsonRequest(`/session/rename/${sessionId}`, 'PATCH', { title: 'Renamed task' })
            expect(renamed.status).toBe(200)
            expect(await renamed.json()).toMatchObject({ id: sessionId, title: 'Renamed task' })

            const moved = await jsonRequest(`/session/cwd/${sessionId}`, 'PATCH', { cwd: process.cwd() })
            expect(moved.status).toBe(200)
            expect(await moved.json()).toEqual({ id: sessionId, cwd: process.cwd(), temporary: false })

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

            const badCwd = await jsonRequest('/session/create', 'POST', { title: 'x', cwd: join(tmpdir(), 'definitely-missing-folder-xyz') })
            expect(badCwd.status).toBe(400)
        })
    })

    test('rejects a create request with no body as a client error', async () => {
        await withHome(async () => {
            const response = await app.handle(new Request('http://localhost/session/create', { method: 'POST' }))
            expect(response.status).toBe(400)
        })
    })

    // 缺字段是用户能自己改的，要在进业务之前就拦住，且错误话说得明白：
    // 直接透传 Elysia 的嵌套 JSON 会变成一坑转义文本，界面没法直接显示。
    test('reports a missing field with a readable message', async () => {
        await withHome(async () => {
            const response = await jsonRequest('/session/create', 'POST', { cwd: process.cwd() })
            expect(response.status).toBe(400)
            const { error } = await response.json()
            expect(error).toContain('title')
            expect(error).toContain('请求体')
            // 不能把嵌套 JSON 原样抖出来
            expect(error).not.toContain('{\n')
        })
    })

    test('rejects a send without input before reaching the agent', async () => {
        await withHome(async () => {
            const response = await jsonRequest('/agent/send/some-session', 'POST', {})
            expect(response.status).toBe(400)
            const { error } = await response.json()
            expect(error).toContain('input')
        })
    })

    test('accepts an image content-block input through HTTP validation', async () => {
        await withHome(async () => {
            const response = await jsonRequest('/agent/send/some-session', 'POST', {
                input: [{ type: 'text', text: '看图' }, { type: 'image', image: 'data:image/png;base64,AA==' }],
            })
            expect(response.status).toBe(404) // 会话不存在，但已经过了形状校验
            const { error } = await response.json()
            expect(error).not.toContain('Expected string')
            expect(error).not.toContain('input 不对')
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

describe('server skills', () => {
    const writeSkill = async (dir, name, description, body) => {
        await mkdir(dir, { recursive: true })
        await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n${body}`)
    }

    test('lists global and project skills, project wins on the same name', async () => {
        await withHome(async root => {
            const project = join(root, 'project')
            await writeSkill(join(root, 'skills', 'review'), 'review', '全局审查', '全局正文')
            await writeSkill(join(project, '.agent', 'skills', 'review'), 'review', '项目审查', '项目正文')
            await writeSkill(join(root, 'skills', 'deploy'), 'deploy', '部署', '部署正文')

            const skills = await Skill.list({ cwd: project, skills: SkillsFeature })
            expect(skills.map(item => item.name).sort()).toEqual(['deploy', 'review'])
            expect(skills.find(item => item.name === 'review').description).toBe('项目审查')
            expect(await Skill.read({ name: 'review', cwd: project, skills: SkillsFeature })).toBe('项目正文')
        })
    })

    test('skips a file without a header and reports an unknown skill as missing', async () => {
        await withHome(async root => {
            await mkdir(join(root, 'skills', 'broken'), { recursive: true })
            await writeFile(join(root, 'skills', 'broken', 'SKILL.md'), '随便写点东西')

            expect((await Skill.list({ cwd: root, skills: SkillsFeature })).map(item => item.name)).not.toContain('broken')
            await expect(Skill.read({ name: 'nope', cwd: root, skills: SkillsFeature })).rejects.toThrow(/Skill not found/)
        })
    })

    test('gives the agent a skill tool listing the available skills', async () => {
        await withHome(async root => {
            await writeSkill(join(root, 'skills', 'review'), 'review', '审查改动', '第一步')
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }] })
            const { sessionId } = await Session.create({ title: 'With skills', cwd: root })
            const agent = Agent.runtime().get(sessionId)

            expect(agent.tools.schema.skill).toBeDefined()
            expect(agent.tools.schema.skill.description).toContain('review')
        })
    })
})

describe('server MCP', () => {
    test('connects a configured MCP server and exposes its tools to the agent', async () => {
        await withHome(async () => {
            await Settings.set({
                providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }],
                mcp: { everything: { command: 'bun', args: ['node_modules/@modelcontextprotocol/server-everything/dist/index.js'] } },
            })

            const mcpTools = await Mcp.tools()
            expect(Object.keys(mcpTools).length).toBeGreaterThan(0)

            const { sessionId } = await Session.create({ title: 'MCP task' })
            const agent = Agent.runtime().get(sessionId)
            expect(Object.keys(agent.tools.schema)).toEqual(expect.arrayContaining(['everything_echo', 'read_file']))

            await Mcp.close()
        })
    })

    test('does not fail when a configured server cannot start', async () => {
        await withHome(async () => {
            await Settings.set({
                providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }],
                mcp: { broken: { command: 'definitely-not-a-real-command-xyz' } },
            })

            const { sessionId } = await Session.create({ title: 'Broken MCP task' })
            expect((await Session.read({ sessionId })).id).toBe(sessionId)
            await Mcp.close()
        })
    })
})

describe('server session list', () => {
    test('lists sessions from disk, newest first, and searches by title', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }] })
            const first = await Session.create({ title: 'Alpha task' })
            await Bun.sleep(5)
            const second = await Session.create({ title: 'Beta task' })

            const all = await Session.list({})
            expect(all).toHaveLength(2)
            expect(all[0].id).toBe(second.sessionId)
            expect(all[0].temporary).toBe(true)
            expect(all[0].cwd).not.toBe(process.cwd())

            const searched = await Session.list({ search: 'alpha' })
            expect(searched).toHaveLength(1)
            expect(searched[0].id).toBe(first.sessionId)
        })
    })

    test('lists sessions through HTTP', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }] })
            await Session.create({ title: 'Visible' })

            const response = await request('/session/list')
            expect(response.status).toBe(200)
            expect((await response.json()).map(item => item.title)).toEqual(['Visible'])
        })
    })

    test('returns an empty list when no session directory exists yet', async () => {
        await withHome(async () => {
            expect(await Session.list({})).toEqual([])
        })
    })
})

describe('server route walk', () => {
    test('reaches every session route and answers with a real message', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }] })
            const created = await jsonRequest('/session/create', 'POST', { title: 'Route walk' })
            const { sessionId } = await created.json()

            for (const [path, method] of [
                [`/session/compact/${sessionId}`, 'POST'],
                [`/session/redo/${sessionId}`, 'POST'],
                [`/session/changes/${sessionId}`, 'GET'],
                [`/session/tools/${sessionId}`, 'GET'],
                [`/session/cwd/${sessionId}`, 'PATCH'],
                ['/health', 'GET'],
            ]) {
                const response = await request(path, {
                    method,
                    ...(method === 'PATCH' ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cwd: process.cwd() }) } : {}),
                })
                const body = await response.json()
                expect(response.status, `${method} ${path} 返回了 ${response.status}: ${JSON.stringify(body)}`).not.toBe(500)
            }
        })
    })
})

describe('server provider test endpoint', () => {
    test('reports an unknown provider as a client error', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }] })
            const response = await jsonRequest('/config/test', 'POST', { provider: 'nope', model: 'm' })
            expect(response.status).toBe(400)
            expect(await response.json()).toMatchObject({ error: 'Provider not found: nope' })
        })
    })

    test('reports a provider without any model as a client error', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [] }] })
            const response = await jsonRequest('/config/test', 'POST', { provider: 'local' })
            expect(response.status).toBe(400)
            expect(await response.json()).toMatchObject({ error: expect.stringContaining('local') })
        })
    })

    test('reports an empty configuration as a client error', async () => {
        await withHome(async () => {
            const response = await jsonRequest('/config/test', 'POST', {})
            expect(response.status).toBe(400)
            expect(await response.json()).toMatchObject({ error: 'no provider or model configured to test' })
        })
    })
})

describe('server health and history', () => {
    test('reports service status', async () => {
        await withHome(async () => {
            const response = await request('/health')
            expect(response.status).toBe(200)
            const status = await response.json()
            expect(status.ok).toBe(true)
            expect(typeof status.version).toBe('string')
            expect(status.targetVersion).toBe(status.version)
            expect(status.restartRequired).toBe(false)
        })
    })

    test('deleting a session also clears its in-memory history', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }] })
            const { sessionId } = await Session.create({ title: 'Delete me' })
            expect(History.count()).toBe(1)
            await Session.remove({ sessionId })
            expect(History.count()).toBe(0)
        })
    })

    test('rolls back and redoes messages through session commands', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }] })
            const { sessionId } = await Session.create({ title: 'History task' })

            await History.add({ sessionId, message: AgentCore.history.user({ content: 'one' }) })
            const second = await History.add({ sessionId, message: AgentCore.history.user({ content: 'two' }) })
            await History.save(sessionId)

            const rolledBack = await Session.rollback({ sessionId, messageId: second.messageId })
            expect(rolledBack.history).toHaveLength(1)
            await Session.redo({ sessionId })
            expect((await Session.read({ sessionId })).history).toHaveLength(2)
        })
    })

    test('persists history inside the session directory', async () => {
        await withHome(async root => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }] })
            const { sessionId } = await Session.create({ title: 'Persist task' })
            await History.add({ sessionId, message: AgentCore.history.user({ content: 'saved' }) })
            await History.save(sessionId)

            const file = join(root, 'sessions', sessionId, 'history.jsonl')
            expect((await readFile(file, 'utf8')).split('\n').filter(Boolean)).toHaveLength(1)
        })
    })

    test('keeps the session history file loadable after a round trip', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }] })
            const { sessionId } = await Session.create({ title: 'Round trip' })
            await History.add({ sessionId, message: AgentCore.history.user({ content: 'hello' }) })
            await History.save(sessionId)

            const reloaded = await Session.read({ sessionId })
            expect(reloaded.history.map(item => item.content)).toEqual(['hello'])
        })
    })

    test('undoes several rollbacks in a row, and a new message clears the undo history', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }] })
            const { sessionId } = await Session.create({ title: 'Multi undo' })
            const first = await History.add({ sessionId, message: AgentCore.history.user({ content: '一' }) })
            await History.add({ sessionId, message: AgentCore.history.user({ content: '二' }) })
            await History.add({ sessionId, message: AgentCore.history.user({ content: '三' }) })
            await History.save(sessionId)

            await Session.rollback({ sessionId, messageId: first.messageId, files: false })
            expect((await Session.read({ sessionId })).history).toHaveLength(0)
            expect((await Session.read({ sessionId })).undoable).toBe(1)

            await Session.redo({ sessionId, files: false })
            expect((await Session.read({ sessionId })).history).toHaveLength(3)
            expect((await Session.read({ sessionId })).undoable).toBe(0)

            await Session.rollback({ sessionId, messageId: first.messageId, files: false })
            expect((await Session.read({ sessionId })).undoable).toBe(1)
            History.add({ sessionId, message: AgentCore.history.user({ content: '新的' }) })
            await History.save(sessionId)
            expect((await Session.read({ sessionId })).undoable).toBe(0)
        })
    })
})

describe('server file snapshots', () => {
    test('restores a modified file when the session rolls back', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }], permission: { '*': 'allow' } })
            const target = join(tmpdir(), `agent-snapshot-${crypto.randomUUID()}.txt`)
            await writeFile(target, 'original')

            const { sessionId } = await Session.create({ title: 'Snapshot task' })
            const blockId = AgentCore.history.user({ content: 'change the file' }).id
            const record = await File.snapshot({ sessionId, messageId: blockId, toolName: 'write_file', input: { path: target } })
            expect(record).toContain(resolve(target))

            await writeFile(target, 'changed by agent')
            const added = await History.add({ sessionId, message: AgentCore.history.user({ content: 'change the file', id: blockId }) })
            await History.save(sessionId)

            const rolledBack = await Session.rollback({ sessionId, messageId: added.messageId })
            expect(rolledBack.restored).toContain(resolve(target))
            expect(await readFile(target, 'utf8')).toBe('original')

            await rm(target, { force: true })
        })
    })

    test('shows what the task changed, including added and deleted files', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }], permission: { '*': 'allow' } })
            const edited = join(tmpdir(), `agent-diff-edit-${crypto.randomUUID()}.txt`)
            const removed = join(tmpdir(), `agent-diff-removed-${crypto.randomUUID()}.txt`)
            const created = join(tmpdir(), `agent-diff-new-${crypto.randomUUID()}.txt`)
            await writeFile(edited, 'before')
            await writeFile(removed, 'will be deleted')

            const { sessionId } = await Session.create({ title: 'Diff task' })
            const added = await History.add({ sessionId, message: AgentCore.history.user({ content: 'change things' }) })
            await History.save(sessionId)
            const messageId = added.message.id

            await Approval.check({ sessionId, messageId, toolCallId: 'd1', toolName: 'write_file', input: { path: edited } })
            await Approval.check({ sessionId, messageId, toolCallId: 'd2', toolName: 'write_file', input: { path: removed } })
            await Approval.check({ sessionId, messageId, toolCallId: 'd3', toolName: 'write_file', input: { path: created } })
            await writeFile(edited, 'after')
            await rm(removed, { force: true })
            await writeFile(created, 'brand new')

            const changes = await Session.changes({ sessionId })
            const byPath = Object.fromEntries(changes.map(item => [item.path, item]))

            expect(byPath[resolve(edited)]).toMatchObject({ before: 'before', after: 'after', added: false, deleted: false })
            expect(byPath[resolve(removed)]).toMatchObject({ before: 'will be deleted', after: '', deleted: true })
            expect(byPath[resolve(created)]).toMatchObject({ before: '', after: 'brand new', added: true })
            expect(changes).toHaveLength(3)

            await rm(edited, { force: true })
            await rm(created, { force: true })
        })
    })

    test('previews a rollback and can roll back the conversation without touching files', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }], permission: { '*': 'allow' } })
            const target = join(tmpdir(), `agent-preview-${crypto.randomUUID()}.txt`)
            await writeFile(target, 'original')

            const { sessionId } = await Session.create({ title: 'Preview task' })
            const first = await History.add({ sessionId, message: AgentCore.history.user({ content: '第一步' }) })
            const second = await History.add({ sessionId, message: AgentCore.history.user({ content: '第二步' }) })
            await History.save(sessionId)

            await File.snapshot({ sessionId, messageId: second.message.id, toolName: 'write_file', input: { path: target } })
            await writeFile(target, 'changed in step two')

            const preview = await Session.rollbackPreview({ sessionId, messageId: first.messageId })
            expect(preview.messages).toBe(2)
            expect(preview.files.map(file => file.path)).toEqual([resolve(target)])
            expect(preview.files[0]).toMatchObject({ before: 'original', after: 'changed in step two' })

            const rolledBack = await Session.rollback({ sessionId, messageId: first.messageId, files: false })
            expect(rolledBack.restored).toEqual([])
            expect(rolledBack.history).toHaveLength(0)
            expect(await readFile(target, 'utf8')).toBe('changed in step two')

            await Session.redo({ sessionId, files: false })
            expect((await Session.read({ sessionId })).history).toHaveLength(2)

            const withFiles = await Session.rollback({ sessionId, messageId: first.messageId })
            expect(withFiles.restored).toContain(resolve(target))
            expect(await readFile(target, 'utf8')).toBe('original')

            await Session.redo({ sessionId })
            expect(await readFile(target, 'utf8')).toBe('changed in step two')

            await rm(target, { force: true })
        })
    })

    test('deletes a file that did not exist before the task', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }], permission: { '*': 'allow' } })
            const target = join(tmpdir(), `agent-new-${crypto.randomUUID()}.txt`)

            const { sessionId } = await Session.create({ title: 'New file task' })
            const added = await History.add({ sessionId, message: AgentCore.history.user({ content: 'create a file' }) })
            await History.save(sessionId)

            await Approval.check({ sessionId, messageId: added.message.id, toolCallId: 'snap-new', toolName: 'write_file', input: { path: target } })
            await writeFile(target, 'created by agent')

            const rolledBack = await Session.rollback({ sessionId, messageId: added.messageId })
            expect(rolledBack.restored).toContain(resolve(target))
            expect(await Bun.file(target).exists()).toBe(false)
        })
    })
})

describe('server tool approval and SSE', () => {
    test('allows configured tools and returns a denial decision', async () => {
        await withHome(async () => {
            await Settings.set({ permission: { '*': 'allow' } })
            expect(await Approval.check({ sessionId: 's', toolCallId: 'c1', toolName: 'execute_command', input: {} })).toBe(true)

            await Settings.set({ permission: { '*': 'ask' } })
            const pending = Approval.check({ sessionId: 's', toolCallId: 'c2', toolName: 'execute_command', input: {} })
            await Bun.sleep(0)
            expect(await Approval.decide({ sessionId: 's', toolCallId: 'c2', decision: 'deny' })).toEqual({ ok: true })
            expect(await pending).toBe(false)
        })
    })

    test('writes an always-allow decision back into the configuration file', async () => {
        await withHome(async () => {
            await Settings.set({ permission: { '*': 'ask' } })
            const pending = Approval.check({ sessionId: 's', toolCallId: 'c3', toolName: 'read_file', input: { path: 'a.txt' } })
            await Bun.sleep(0)
            await Approval.decide({ sessionId: 's', toolCallId: 'c3', decision: 'allow-always' })
            expect(await pending).toBe(true)

            expect(await Approval.check({ sessionId: 's', toolCallId: 'c4', toolName: 'read_file', input: { path: 'a.txt' } })).toBe(true)
        })
    })

    test('rejects an unknown decision with a client error and keeps waiting', async () => {
        await withHome(async () => {
            await Settings.set({ permission: { '*': 'ask' } })
            const pending = Approval.check({ sessionId: 's', toolCallId: 'c5', toolName: 'execute_command', input: {} })
            await Bun.sleep(0)
            await expect(Approval.decide({ sessionId: 's', toolCallId: 'c5', decision: 'maybe' })).rejects.toMatchObject({ status: 400 })

            await Approval.decide({ sessionId: 's', toolCallId: 'c5', decision: 'allow-once' })
            expect(await pending).toBe(true)
        })
    })

    test.each(['input.txt', 'input (1).txt'])('remembers an exact Windows path across sessions: %s', async filename => {
        await withHome(async () => {
            await Settings.set({ permission: { '*': 'ask' } })
            const target = 'F:\\workspace\\中文 目录\\' + filename
            const waitFor = async (sessionId, callId) => {
                // 审批请求什么时候登记由 check 的异步链决定，轮询等它出现再决定，不猜时序。
                for (let index = 0; index < 200; index++) {
                    if ((await Approval.pending(sessionId)).some(item => item.callID === callId)) return
                    await Bun.sleep(10)
                }
                throw new Error(`approval ${callId} never appeared`)
            }

            const first = Approval.check({ sessionId: 's', toolCallId: 'r1', toolName: 'read_file', input: { path: target } })
            await waitFor('s', 'r1')
            await Approval.decide({ sessionId: 's', toolCallId: 'r1', decision: 'allow-always' })
            expect(await first).toBe(true)

            // 同一会话：不再询问。
            expect(await Approval.check({ sessionId: 's', toolCallId: 'r2', toolName: 'read_file', input: { path: target } })).toBe(true)

            // 新会话：审批状态里没有这条记录，规则要从配置里命中——issue #9 的主场景。
            expect(await Approval.check({ sessionId: 'other', toolCallId: 'r3', toolName: 'read_file', input: { path: target } })).toBe(true)

            // 相似但不同的路径不自动放行：仍然要问，最后拒绝掉。
            const different = Approval.check({ sessionId: 'other', toolCallId: 'r4', toolName: 'read_file', input: { path: 'F:\\workspace\\中文 目录\\other (1).txt' } })
            await waitFor('other', 'r4')
            await Approval.decide({ sessionId: 'other', toolCallId: 'r4', decision: 'deny' })
            expect(await different).toBe(false)
        })
    })
    test('remembers a whole command instead of one exact argument list', async () => {
        await withHome(async () => {
            await Settings.set({ permission: { '*': 'ask' } })
            const pending = Approval.check({ sessionId: 's', toolCallId: 's1', toolName: 'execute_command', input: { command: 'make build --fast' } })
            await Bun.sleep(0)
            await Approval.decide({ sessionId: 's', toolCallId: 's1', decision: 'allow-always' })
            expect(await pending).toBe(true)

            expect(await Approval.check({ sessionId: 's', toolCallId: 's2', toolName: 'execute_command', input: { command: 'make build --release' } })).toBe(true)
            // 不同子命令仍要问，最后拒绝掉：不给进程留未决的审批 Promise，-t 单跑也能正常退出。
            const deploy = Approval.check({ sessionId: 's', toolCallId: 's3', toolName: 'execute_command', input: { command: 'make deploy' } })
            for (let index = 0; index < 200; index++) {
                if ((await Approval.pending('s')).some(item => item.callID === 's3')) break
                await Bun.sleep(10)
            }
            await Approval.decide({ sessionId: 's', toolCallId: 's3', decision: 'deny' })
            expect(await deploy).toBe(false)
        })
    })

    test('shows a waiting approval after the page is reloaded', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }], permission: { '*': 'ask' } })
            const { sessionId } = await Session.create({ title: 'Waiting approval' })

            const waiting = Approval.check({ sessionId, toolCallId: 'w1', toolName: 'execute_command', input: { command: 'rm -rf build' } })
            await Bun.sleep(0)

            const reloaded = await Session.read({ sessionId })
            expect(reloaded.pending).toHaveLength(1)
            expect(reloaded.pending[0]).toMatchObject({ callID: 'w1', tool: 'execute_command' })

            await Approval.decide({ sessionId, toolCallId: 'w1', decision: 'allow-once' })
            expect(await waiting).toBe(true)
            expect((await Session.read({ sessionId })).pending).toEqual([])
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

    test('aborting before the stream starts only closes that connection', async () => {
        const id = `sse-abort-${crypto.randomUUID()}`
        const controller = new AbortController()
        const response = await SSE.connect({
            id,
            request: new Request('http://localhost/sse', { signal: controller.signal }),
        })
        const reader = response.body.getReader()
        controller.abort()

        const result = await Promise.race([reader.read(), Bun.sleep(500).then(() => null)])
        expect(result?.done).toBe(true)
        await SSE.close({ id })
    })

    test('closing immediately closes the stream without an unhandled rejection', async () => {
        const id = `sse-close-${crypto.randomUUID()}`
        const response = await SSE.connect({ id, request: new Request('http://localhost/sse') })
        const reader = response.body.getReader()
        await SSE.close({ id })

        const result = await Promise.race([reader.read(), Bun.sleep(500).then(() => null)])
        expect(result?.done).toBe(true)
    })

    test('replacing a connection keeps cached events and writes to the new one', async () => {
        const id = `sse-replace-${crypto.randomUUID()}`
        const first = await SSE.connect({ id, request: new Request('http://localhost/sse') })
        const firstReader = first.body.getReader()
        await SSE.send({ id, data: { type: 'kept' } })
        const firstEvent = await Promise.race([firstReader.read(), Bun.sleep(500).then(() => null)])
        expect(new TextDecoder().decode(firstEvent.value)).toContain('kept')

        const second = await SSE.connect({ id, request: new Request('http://localhost/sse') })
        const secondReader = second.body.getReader()
        const event = await Promise.race([secondReader.read(), Bun.sleep(500).then(() => null)])
        expect(event?.done).not.toBe(true)
        expect(new TextDecoder().decode(event.value)).toContain('kept')

        const closed = await Promise.race([firstReader.read(), Bun.sleep(500).then(() => null)])
        expect(closed?.done).toBe(true)
        await SSE.close({ id })
    })

    test('abort, close and replace do not crash a child process', () => {
        const script = fileURLToPath(new URL('./sse-exit.js', import.meta.url))
        for (const mode of ['abort', 'close', 'replace']) {
            const result = spawnSync(process.execPath, [script, mode], { encoding: 'utf8', timeout: 10000 })
            expect(result.status, `${mode}: ${result.stderr || result.stdout}`).toBe(0)
        }
    })
})

describe('请求用量', () => {
    test('记录首字时间和完整耗时', () => {
        const usage = usageOf({
            usage: { inputTokens: 30, outputTokens: 20, totalTokens: 50 },
            startedAt: 1000,
            firstTokenAt: 2500,
            finishedAt: 9000,
            provider: 'local',
            model: 'model',
        })
        expect(usage).toMatchObject({ input: 30, output: 20, total: 50, firstTokenMs: 1500, durationMs: 8000, provider: 'local', model: 'model' })
        // 没有首字时就是 0，前端据此省略这一项。
        expect(usageOf({ usage: null, startedAt: 1000, finishedAt: 2000 }).firstTokenMs).toBe(0)
    })

    // 供应商返回的用量属于系统边界：脏值不能进入统计。
    // 统计面板曾因一个 9 位数显示成 908.7M tokens，用户无法分辨真假。
    test('把脏 token 值挡在外面', () => {
        const dirty = (inputTokens, outputTokens) => usageOf({ usage: { inputTokens, outputTokens }, startedAt: 0, finishedAt: 0 })

        // 正常值原样保留
        expect(dirty(120, 80)).toMatchObject({ input: 120, output: 80, total: 200 })
        // 字符串数字仍当数字（有的供应商就这么发）
        expect(dirty('120', '80')).toMatchObject({ input: 120, output: 80 })
        // 负数、NaN、Infinity、null 一律按 0，不能变成负统计或 NaN
        expect(dirty(-5, 0)).toMatchObject({ input: 0, output: 0 })
        expect(dirty('abc', undefined)).toMatchObject({ input: 0, output: 0 })
        expect(dirty(Infinity, 0)).toMatchObject({ input: 0, output: 0 })
        expect(dirty(null, null)).toMatchObject({ input: 0, output: 0 })
        // 超过单次请求上限的脏值也拦住（908.7M 就是这一类）
        expect(dirty(908_700_000, 0)).toMatchObject({ input: 0, output: 0 })
        // 小数取整：token 计数不该带小数
        expect(dirty(12.6, 7.4)).toMatchObject({ input: 13, output: 7 })
    })

    test('总数为脏值时退回自己算的那份', () => {
        const usage = usageOf({ usage: { inputTokens: 10, outputTokens: 5, totalTokens: 908_700_000 }, startedAt: 0, finishedAt: 0 })
        expect(usage.total).toBe(15)
    })
})

describe('server Agent integration boundary', () => {
    test('creates a session with Agent through the package boundary', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }] })
            const { sessionId } = await Session.create({ title: 'Agent boundary' })
            const session = await Session.read({ sessionId })
            expect(session.id).toBe(sessionId)
            expect(session.history).toEqual([])
        })
    })

    test('scans the grouped built-in tool files', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }] })
            const { sessionId } = await Session.create({ title: 'Tool scan' })
            const agent = Agent.runtime().get(sessionId)
            expect(Object.keys(agent.tools.schema)).toEqual(expect.arrayContaining([
                'read_file', 'write_file', 'find_files', 'search_text', 'edit',
                'move_file', 'copy_file',
                'execute_command', 'background', 'update_todo_list', 'webfetch', 'ctx_usage',
                'attempt_completion', 'ask_followup_question',
            ]))
            // cwd / test 工具已删除；new_task 已下架（子智能体正式版再引入）。
            expect(Object.keys(agent.tools.schema)).not.toContain('cwd')
            expect(Object.keys(agent.tools.schema)).not.toContain('new_task')
        })
    })
})
