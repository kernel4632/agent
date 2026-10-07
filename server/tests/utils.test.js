/*
 * 后端功能测试：用真实 HTTP 请求和真实数据目录走一遍主要功能，包括填错的情况。
 *
 * 每个测试在自己的临时数据目录里跑，互不影响。
 * 运行：cd server && bun test
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import Agent from '@kernel4632/agent-core'

import Approval from '../features/approval.js'
import Config from '../commands/config.js'
import History from '../features/history.js'
import Ignore from '../features/ignore.js'
import Delegation from '../features/delegation.js'
import Mcp from '../features/mcp.js'
import Session from '../commands/session.js'
import Skills from '../features/skills.js'
import Snapshot from '../features/snapshot.js'
import Store from '../store.js'
import { app } from '../server.js'
import SSE from '../utils/sse.js'

// 每个测试使用独立目录和干净的内存数据，避免测试之间互相影响。
const withHome = async callback => {
    const root = join(tmpdir(), `agent-server-${crypto.randomUUID()}`)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    // Store 是模块级的，不清空的话上一个测试的配置会留在下一个测试里。
    Object.keys(Store.config).forEach(key => delete Store.config[key])
    Store.agents.clear()
    Store.sessions.clear()
    Store.snapshots.clear()
    Store.approvals.clear()

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

describe('server delegation', () => {
    test('builds a task tool whose sub-agent cannot delegate again', async () => {
        await withHome(async () => {
            const scanned = await (await import('@kernel4632/agent-core')).default.tool.from('./tools')
            const task = Delegation.build({ config: { baseURL: 'http://127.0.0.1:1/v1', model: 'm', retryMaxElapsed: 1, retryBaseDelay: 1 }, tools: scanned })

            // 和别的工具合起来之后，主 agent 的工具表里有 task。
            const merged = (await import('@kernel4632/agent-core')).default.tool.merge(scanned, (await import('@kernel4632/agent-core')).default.tool.adopt({ task }))
            expect(Object.keys(merged.schema)).toContain('task')

            // 真跑一次：子 agent 连不上模型，错误作为结论回来，不该抛出去打断主任务。
            const result = await task.execute({ description: '查点东西', prompt: '随便看看' }, {})
            expect(result.description).toBe('查点东西')
            expect(typeof result.error).toBe('string')
        })
    })

    test('stops the sub-agent when the main task is stopped', async () => {
        await withHome(async () => {
            const scanned = await (await import('@kernel4632/agent-core')).default.tool.from('./tools')
            const task = Delegation.build({ config: { baseURL: 'http://127.0.0.1:1/v1', model: 'm', retryMaxElapsed: 1, retryBaseDelay: 1 }, tools: scanned })

            // 一进来就是已取消状态，子 agent 不该继续跑下去。
            const controller = new AbortController()
            controller.abort()
            const result = await task.execute({ description: '查东西', prompt: '看看' }, { abortSignal: controller.signal })
            expect(result.description).toBe('查东西')
            // 取消或失败都只作为结论返回，不往外抛。
            expect(result.error || result.reason).toBeDefined()
        })
    })
})

describe('server skills', () => {
    test('lists skills from the data directory and reads one on demand', async () => {
        await withHome(async root => {
            // 用户往 skills/ 放一个技能文件夹，agent 就能用上它。
            await mkdir(join(root, 'skills', 'review-pr'), { recursive: true })
            await writeFile(join(root, 'skills', 'review-pr', 'SKILL.md'), `---
name: review-pr
description: 审查一个 PR 时用这个
---

第一步：读 diff。
`)

            // 清单里既有内置技能，也有用户刚放进去的这个。
            const list = await Skills.list()
            expect(list.map(item => item.name)).toContain('review-pr')
            expect(await Skills.read('review-pr')).toContain('第一步')
            // 模型看到的是清单，不是所有正文。
            const tools = await Skills.tools()
            expect(JSON.stringify(tools.skill.description)).toContain('review-pr')
        })
    })

    test('skips a file without a header and reports an unknown skill as missing', async () => {
        await withHome(async root => {
            await mkdir(join(root, 'skills', 'broken'), { recursive: true })
            // 没有开头那段就认不出是什么技能，跳过它，不让它挡住别的技能。
            await writeFile(join(root, 'skills', 'broken', 'SKILL.md'), '随便写点东西')

            // 坏文件不出现在清单里，但内置技能照常在。
            const names = (await Skills.list()).map(item => item.name)
            expect(names).not.toContain('broken')
            expect(names).toContain('elysiajs')
            await expect(Skills.read('nope')).rejects.toMatchObject({ status: 404 })
        })
    })

    test('lets a user skill replace a built-in one with the same name', async () => {
        await withHome(async root => {
            // 内置有 elysiajs；用户在数据目录里放一个同名的，应当以用户的为准。
            await mkdir(join(root, 'skills', 'elysiajs'), { recursive: true })
            await writeFile(join(root, 'skills', 'elysiajs', 'SKILL.md'), '---\nname: elysiajs\ndescription: 我们公司自己的写法\n---\n用我们自己的约定')

            const found = (await Skills.list()).filter(item => item.name === 'elysiajs')
            expect(found).toHaveLength(1)
            expect(found[0].description).toBe('我们公司自己的写法')
            expect(await Skills.read('elysiajs')).toContain('我们自己的约定')
        })
    })

    test('gives the agent a skill tool listing the built-in skills', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }] })
            const { sessionId } = await Session.create({ title: 'With skills' })
            const agent = (await import('../store.js')).default.agents.get(sessionId)

            // 内置技能跟着代码走，任何环境上都该有。
            expect(agent.tools.schema.skill).toBeDefined()
            expect(agent.tools.schema.skill.description).toContain('elysiajs')
        })
    })
})

describe('server MCP', () => {
    test('connects a configured MCP server and exposes its tools to the agent', async () => {
        await withHome(async () => {
            // 用一个真的 stdio MCP 服务验证整条路：连上 → 拿到工具 → 交给 Agent。
            await Config.set({
                providers: [{ name: 'local', models: ['model'] }],
                mcp: { everything: { command: 'bun', args: ['node_modules/@modelcontextprotocol/server-everything/dist/index.js'] } },
            })

            const mcpTools = await Mcp.tools()
            expect(Object.keys(mcpTools).length).toBeGreaterThan(0)

            const { sessionId } = await Session.create({ title: 'MCP task' })
            const agent = (await import('../store.js')).default.agents.get(sessionId)
            // 服务给的工具名前面带了服务名，和内置工具摆在同一份工具表里。
            expect(Object.keys(agent.tools.schema)).toEqual(expect.arrayContaining(['everything_echo', 'file_read']))

            await Mcp.close()
        })
    })

    test('does not fail when a configured server cannot start', async () => {
        await withHome(async () => {
            await Config.set({
                providers: [{ name: 'local', models: ['model'] }],
                // 一个根本不存在的命令：连不上不该让整个会话创建失败。
                mcp: { broken: { command: 'definitely-not-a-real-command-xyz' } },
            })

            const { sessionId } = await Session.create({ title: 'Broken MCP task' })
            const session = await Session.read({ sessionId })
            expect(session.id).toBe(sessionId)
            await Mcp.close()
        })
    })
})

describe('server session list', () => {
    test('lists sessions from disk, newest first, and searches by title', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }] })
            const first = await Session.create({ title: 'Alpha task' })
            // 造一点时间差，好让排序有东西可排。
            await Bun.sleep(5)
            const second = await Session.create({ title: 'Beta task' })

            const all = await Session.list({})
            expect(all).toHaveLength(2)
            // 最近用过的排在前面。
            expect(all[0].id).toBe(second.sessionId)

            // 搜索按标题匹配，找不到的不会出现在结果里。
            const searched = await Session.list({ search: 'alpha' })
            expect(searched).toHaveLength(1)
            expect(searched[0].id).toBe(first.sessionId)
        })
    })

    test('lists sessions through HTTP', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }] })
            await Session.create({ title: 'Visible' })

            const response = await request('/session/list')
            expect(response.status).toBe(200)
            const sessions = await response.json()
            expect(sessions.map(item => item.title)).toEqual(['Visible'])
        })
    })

    test('returns an empty list when no session directory exists yet', async () => {
        await withHome(async () => {
            // 全新安装时 sessions/ 目录还不存在，列出空的而不是报错。
            expect(await Session.list({})).toEqual([])
        })
    })
})

describe('server route walk', () => {
    test('reaches every session route and answers with a real message', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }] })
            const created = await jsonRequest('/session/create', 'POST', { title: 'Route walk' })
            const { sessionId } = await created.json()

            // 这些接口都要真的走一遍。没有真模型时它们可以报错，但报错必须说清是哪件事不行，
            // 而不是路由写错导致的 undefined、is not a function 这种。
            for (const [path, method] of [
                [`/session/compact/${sessionId}`, 'POST'],
                [`/session/redo/${sessionId}`, 'POST'],
                [`/session/changes/${sessionId}`, 'GET'],
                ['/health', 'GET'],
                ['/workspace/status', 'GET'],
            ]) {
                const response = await request(path, { method })
                const body = await response.json()
                expect(response.status, `${method} ${path} 返回了 ${response.status}: ${JSON.stringify(body)}`).not.toBe(500)
            }
        })
    })
})

describe('server provider test endpoint', () => {
    test('reports an unknown provider as a client error', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }] })
            // 这里不真的打模型服务：供应商不存在时在发请求之前就该被挡下。
            const response = await jsonRequest('/config/test', 'POST', { provider: 'nope', model: 'm' })
            expect(response.status).toBe(400)
            // 说清是哪个名字不存在，别让用户以为自己压根没配过供应商。
            expect(await response.json()).toMatchObject({ error: 'Provider not found: nope' })
        })
    })

    test('reports a provider without any model as a client error', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: [] }] })
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

describe('server health and workspace', () => {
    test('reports service status', async () => {
        await withHome(async () => {
            const response = await request('/health')
            expect(response.status).toBe(200)
            const status = await response.json()
            expect(status.ok).toBe(true)
            expect(typeof status.version).toBe('string')
        })
    })

    test('reports the workspace path, file list and git state', async () => {
        await withHome(async () => {
            const response = await request('/workspace/read')
            expect(response.status).toBe(200)
            const workspace = await response.json()
            expect(typeof workspace.path).toBe('string')
            expect(Array.isArray(workspace.files)).toBe(true)
            // 不是 git 仓库时是 null，是仓库时带分支名，两种都算正常。
            expect(workspace.git === null || typeof workspace.git.branch === 'string').toBe(true)
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
            await Config.set({ providers: [{ name: 'local', models: ['model'] }] })
            const { sessionId } = await Session.create({ title: 'Persist task' })
            await History.add({ sessionId, message: Agent.history.user({ content: 'saved' }) })
            await History.save({ sessionId })

            const file = join(root, 'sessions', sessionId, 'history.json')
            expect(JSON.parse(await readFile(file, 'utf8')).messages).toHaveLength(1)
        })
    })

    test('keeps the session history file loadable after a round trip', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }] })
            const { sessionId } = await Session.create({ title: 'Round trip' })
            await History.add({ sessionId, message: Agent.history.user({ content: 'hello' }) })
            await History.save({ sessionId })

            // 重新走一次读取路径：内存里没有这台 Agent 时应当能从磁盘恢复历史。
            const reloaded = await Session.read({ sessionId })
            expect(reloaded.history.map(item => item.content)).toEqual(['hello'])
        })
    })
})

describe('server file snapshots', () => {
    test('restores a modified file when the session rolls back', async () => {
        await withHome(async () => {
            // 配置是整体替换，所以权限和模型服务必须一次写全。
            await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'allow' } })
            const target = join(tmpdir(), `agent-snapshot-${crypto.randomUUID()}.txt`)
            await writeFile(target, 'original')

            const { sessionId } = await Session.create({ title: 'Snapshot task' })
            // 快照挂在用户消息的块 id 上，这里直接构造一条同样的消息。
            const blockId = Agent.history.user({ content: 'change the file' }).id
            const record = await Snapshot.save({ sessionId, messageId: blockId, toolName: 'file_write', input: { path: target } })
            expect(record).toContain(resolve(target))

            // 工具改文件，随后回退到这条用户消息之前。
            await writeFile(target, 'changed by agent')
            const added = await History.add({ sessionId, message: Agent.history.user({ content: 'change the file', id: blockId }) })
            await History.save({ sessionId })

            const rolledBack = await Session.rollback({ sessionId, messageId: added.messageId })
            expect(rolledBack.restored).toContain(resolve(target))
            expect(await readFile(target, 'utf8')).toBe('original')

            await rm(target, { force: true })
        })
    })

    test('shows what the task changed, including added and deleted files', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'allow' } })
            const edited = join(tmpdir(), `agent-diff-edit-${crypto.randomUUID()}.txt`)
            const removed = join(tmpdir(), `agent-diff-removed-${crypto.randomUUID()}.txt`)
            const created = join(tmpdir(), `agent-diff-new-${crypto.randomUUID()}.txt`)
            await writeFile(edited, 'before')
            await writeFile(removed, 'will be deleted')

            const { sessionId } = await Session.create({ title: 'Diff task' })
            const added = await History.add({ sessionId, message: Agent.history.user({ content: 'change things' }) })
            await History.save({ sessionId })
            const messageId = added.message.id

            // 三个文件各来一次改动：改内容、删掉、新建。
            await Approval.check({ sessionId, messageId, toolCallId: 'd1', toolName: 'file_write', input: { path: edited } })
            await Approval.check({ sessionId, messageId, toolCallId: 'd2', toolName: 'file_write', input: { path: removed } })
            await Approval.check({ sessionId, messageId, toolCallId: 'd3', toolName: 'file_write', input: { path: created } })
            await writeFile(edited, 'after')
            await rm(removed, { force: true })
            await writeFile(created, 'brand new')

            const changes = await Session.changes({ sessionId })
            const byPath = Object.fromEntries(changes.map(item => [item.path, item]))

            expect(byPath[resolve(edited)]).toMatchObject({ before: 'before', after: 'after', added: false, deleted: false })
            expect(byPath[resolve(removed)]).toMatchObject({ before: 'will be deleted', after: '', deleted: true })
            expect(byPath[resolve(created)]).toMatchObject({ before: '', after: 'brand new', added: true })
            // 没被碰过的文件不该出现在结果里。
            expect(changes).toHaveLength(3)

            await rm(edited, { force: true })
            await rm(created, { force: true })
        })
    })

    test('deletes a file that did not exist before the task', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'allow' } })
            const target = join(tmpdir(), `agent-new-${crypto.randomUUID()}.txt`)

            const { sessionId } = await Session.create({ title: 'New file task' })
            const added = await History.add({ sessionId, message: Agent.history.user({ content: 'create a file' }) })
            await History.save({ sessionId })

            // 文件在任务开始时还不存在，工具新建了它。
            await Approval.check({ sessionId, messageId: added.message.id, toolCallId: 'snap-new', toolName: 'file_write', input: { path: target } })
            await writeFile(target, 'created by agent')

            const rolledBack = await Session.rollback({ sessionId, messageId: added.messageId })
            expect(rolledBack.restored).toContain(resolve(target))
            expect(await Bun.file(target).exists()).toBe(false) // 回退要把它删掉，回到"本来没有这个文件"。
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

    test('remembers a whole command instead of one exact argument list', async () => {
        await withHome(async () => {
            await Config.set({ permission: { '*': 'ask' } })
            const pending = Approval.check({ sessionId: 's', toolCallId: 's1', toolName: 'shell', input: { command: 'git commit -m "first message"' } })
            await Approval.decide({ sessionId: 's', toolCallId: 's1', decision: 'allow-always' })
            expect(await pending).toBe(true)

            // 换一条提交信息还是同一个操作，不该再问一遍。
            expect(await Approval.check({ sessionId: 's', toolCallId: 's2', toolName: 'shell', input: { command: 'git commit -m "totally different message"' } })).toBe(true)
            // 另一个操作仍然要问。
            const push = Approval.check({ sessionId: 's', toolCallId: 's3', toolName: 'shell', input: { command: 'git push origin main' } })
            await Approval.decide({ sessionId: 's', toolCallId: 's3', decision: 'deny' })
            expect(await push).toBe(false)
        })
    })

    test('shows a waiting approval after the page is reloaded', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'ask' } })
            const { sessionId } = await Session.create({ title: 'Waiting approval' })

            // 用户提交了一个工具调用，正在等批准。
            const waiting = Approval.check({ sessionId, toolCallId: 'w1', toolName: 'shell', input: { command: 'rm -rf build' } })
            await Bun.sleep(0)

            // 刷新页面后前端重新读会话，应当能看到"有个工具在等"。
            const reloaded = await Session.read({ sessionId })
            expect(reloaded.pending).toHaveLength(1)
            expect(reloaded.pending[0]).toMatchObject({ callID: 'w1', tool: 'shell' })

            // 批准之后就不再是等待状态了。
            await Approval.decide({ sessionId, toolCallId: 'w1', decision: 'allow-once' })
            expect(await waiting).toBe(true)
            expect((await Session.read({ sessionId })).pending).toEqual([])
        })
    })

    test('refuses to touch files the ignore rules protect', async () => {
        await withHome(async () => {
            await Config.set({ permission: { '*': 'allow' } })
            await Ignore.load()

            // 密钥文件即使权限规则全部放行也读不到。
            expect(await Approval.check({ sessionId: 's', toolCallId: 'i1', toolName: 'file_read', input: { path: 'D:/app/.env' } })).toBe(false)
            // 普通源码照常放行。
            expect(await Approval.check({ sessionId: 's', toolCallId: 'i2', toolName: 'file_read', input: { path: 'D:/app/src/a.js' } })).toBe(true)
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
            expect(Object.keys(agent.tools.schema)).toEqual(expect.arrayContaining([
                'file_read', 'file_write', 'file_list', 'edit', 'apply_patch',
                'shell', 'glob', 'grep', 'todo', 'webfetch', 'finish', 'ask',
            ]))
        })
    })
})
