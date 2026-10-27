/*
 * 智能体层测试：内置智能体、配置迁移、角色说明、模型和权限覆盖。
 * 每个测试在自己的临时数据目录里跑，互不影响。
 * 运行：cd server && bun test
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import Agents from '../config/agents.js'
import Approval from '../safety/approval.js'
import Config from '../config/config.js'
import Path from '../utils/path.js'
import Session from '../session/session.js'
import Settings from '../config/settings.js'
import Store from '../store.js'
import History from '../session/history.js' // 会话历史的内存缓存由 history.js 自己管。
import { app } from '../server.js'

const withHome = async callback => {
    const root = join(tmpdir(), `agent-agents-${crypto.randomUUID()}`)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    Object.keys(Store.config).forEach(key => delete Store.config[key])
    Store.agents.clear()
    History.clear()
    Store.snapshots.clear()
    Store.approvals.clear()
    Store.settings.clear()
    Store.autoApproved.clear()
    try {
        return await callback(root)
    } finally {
        if (previousHome === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previousHome
        await rm(root, { recursive: true, force: true })
    }
}

const configure = async (extra = {}) => {
    await Config.set({
        providers: [{ name: 'local', models: ['main', 'agent-model'] }],
        permission: { '*': 'ask' },
        rules: { enabled: false },
        ...extra,
    })
    const { sessionId } = await Session.create({ title: '智能体测试' })
    return sessionId
}

const toolNames = sessionId => Object.keys(Store.agents.get(sessionId).tools.schema).sort()

const runCheck = async ({ sessionId, toolCallId, toolName, input = {} }) => {
    const result = Approval.check({ sessionId, toolCallId, toolName, input })
    await Bun.sleep(0)
    const asked = Store.approvals.has(`${sessionId}:${toolCallId}`)
    return { result, asked }
}

describe('智能体定义', () => {
    test('内置执行、计划、问答、调试四个智能体', async () => {
        await withHome(async () => {
            const names = Agents.list({}).map(item => item.name)
            expect(names).toEqual(['build', 'plan', 'ask', 'debug'])
            expect(Agents.get({}, 'ask').readOnly).toBe(true)
            expect(Agents.get({}, 'build').readOnly).toBe(false)
        })
    })

    test('旧配置里的 modes 会迁移成 agents', async () => {
        await withHome(async () => {
            await Config.set({
                providers: [{ name: 'local', models: ['model'] }],
                modes: { review: { label: '审查', readOnly: true } },
            })
            expect(Config.get().modes).toBeUndefined()
            expect(Config.get().agents.review).toEqual({ label: '审查', readOnly: true })
            expect(Settings.agents().map(item => item.name)).toContain('review')
        })
    })

    test('配置文件里的 modes 在读取时迁移', async () => {
        await withHome(async () => {
            const path = Path.config()
            await mkdir(dirname(path), { recursive: true })
            await writeFile(path, JSON.stringify({
                providers: [{ name: 'local', models: ['model'] }],
                modes: { audit: { label: '审计' } },
            }))
            const config = await Config.read(path)
            expect(config.modes).toBeUndefined()
            expect(config.agents.audit.label).toBe('审计')
        })
    })

    test('自定义说明会拼进系统提示词，排在用户提示词之后', async () => {
        await withHome(async () => {
            const sessionId = await configure({
                prompt: { system: 'BASE PROMPT' },
                agents: { reviewer: { label: '审查', instructions: '只审查，不改文件。' } },
            })
            await Session.saveSettings({ sessionId, agent: 'reviewer' })
            const system = Store.agents.get(sessionId).config.system
            expect(system).toContain('BASE PROMPT')
            expect(system).toContain('只审查，不改文件。')
            expect(system.indexOf('BASE PROMPT')).toBeLessThan(system.indexOf('只审查'))
        })
    })

    test('内置智能体也能被同名条目覆盖', async () => {
        await withHome(async () => {
            const sessionId = await configure({
                prompt: { system: 'BASE' },
                agents: { build: { instructions: '这个项目用 Bun。' } },
            })
            expect(Store.agents.get(sessionId).config.system).toContain('这个项目用 Bun。')
        })
    })

    test('问答智能体只给只读工具，不开子任务', async () => {
        await withHome(async () => {
            const sessionId = await configure()
            await Session.saveSettings({ sessionId, agent: 'ask' })
            const names = toolNames(sessionId)
            expect(names).toContain('read_file')
            expect(names).toContain('search_files')
            expect(names).not.toContain('write_to_file')
            expect(names).not.toContain('execute_command')
            expect(names).not.toContain('new_task')
        })
    })

    test('智能体自带模型时切换过去会更新会话模型', async () => {
        await withHome(async () => {
            const sessionId = await configure({
                agents: { smart: { label: '聪明', model: { provider: 'local', model: 'agent-model' } } },
            })
            const before = await Session.read({ sessionId })
            expect(before.model).toBe('main')

            await Session.saveSettings({ sessionId, agent: 'smart' })
            expect((await Session.read({ sessionId })).model).toBe('agent-model')
            expect(Store.agents.get(sessionId).config.model).toBe('agent-model')
        })
    })

    test('切回不带模型的智能体时保留当前模型', async () => {
        await withHome(async () => {
            const sessionId = await configure({
                agents: { smart: { label: '聪明', model: { provider: 'local', model: 'agent-model' } } },
            })
            await Session.saveSettings({ sessionId, agent: 'smart' })
            await Session.saveSettings({ sessionId, agent: 'build' })
            expect((await Session.read({ sessionId })).model).toBe('agent-model')
        })
    })

    test('智能体权限可以拒绝工具，自动批准绕不过去', async () => {
        await withHome(async () => {
            const sessionId = await configure({
                agents: { locked: { label: '锁定', permission: { read_file: 'deny' } } },
            })
            await Session.saveSettings({ sessionId, agent: 'locked', autoApprove: { read: true } })
            const { result, asked } = await runCheck({
                sessionId,
                toolCallId: 'r1',
                toolName: 'read_file',
                input: { path: 'D:/app/a.js' },
            })
            expect(await result).toBe(false)
            expect(asked).toBe(false)
        })
    })

    test('始终允许会写进智能体自己的 permission，不改全局规则', async () => {
        await withHome(async () => {
            const sessionId = await configure({
                agents: { locked: { label: '锁定', permission: { '*': 'ask' } } },
            })
            await Session.saveSettings({ sessionId, agent: 'locked' })
            const first = await runCheck({
                sessionId,
                toolCallId: 'r1',
                toolName: 'read_file',
                input: { path: 'D:/app/a.js' },
            })
            expect(first.asked).toBe(true)
            await Approval.decide({ sessionId, toolCallId: 'r1', decision: 'allow-always' })
            expect(await first.result).toBe(true)

            expect(Config.get().agents.locked.permission.read_file['D:/app/a.js']).toBe('allow')
            expect(Config.get().permission.read_file).toBeUndefined()
        })
    })

    test('新会话使用设置页保存的默认模型和上下文默认值', async () => {
        await withHome(async () => {
            await Config.set({
                providers: [{ name: 'local', models: ['main', 'agent-model'] }],
                permission: { '*': 'ask' },
                rules: { enabled: false },
                model: { provider: 'local', model: 'agent-model' },
                capabilities: { image: false, cache: true, stream: false },
                uses: { compact: { provider: 'local', model: 'main' } },
                compactThreshold: 0.6,
                autoTitle: false,
            })
            const { sessionId } = await Session.create({ title: '全局默认值' })
            const settings = await Session.readSettings({ sessionId })
            expect((await Session.read({ sessionId })).model).toBe('agent-model')
            expect(settings.capabilities).toEqual({ image: false, cache: true, stream: false })
            expect(settings.uses).toEqual({ compact: { provider: 'local', model: 'main' } })
            expect(settings.compactThreshold).toBe(0.6)
            expect(settings.autoTitle).toBe(false)
        })
    })

    test('旧设置文件里的 mode 会迁移成 agent', async () => {
        await withHome(async () => {
            const sessionId = await configure()
            const path = Path.settings(sessionId)
            await writeFile(path, JSON.stringify({
                mode: 'plan',
                autoApprove: { read: true },
                capabilities: { image: true, cache: true, stream: true },
            }))
            Store.settings.clear()

            const settings = await Session.readSettings({ sessionId })
            expect(settings.agent).toBe('plan')
            expect(settings.mode).toBeUndefined()
            expect(settings.autoApprove.read).toBe(true)
        })
    })

    test('写错智能体名按填错处理', async () => {
        await withHome(async () => {
            const sessionId = await configure()
            await expect(Session.saveSettings({ sessionId, agent: 'nope' })).rejects.toMatchObject({ status: 400 })
            expect((await Session.readSettings({ sessionId })).agent).toBe('build')
        })
    })

    test('HTTP 接口能列出智能体', async () => {
        await withHome(async () => {
            await configure({
                agents: { review: { label: '审查', description: '只读审查' } },
            })
            const response = await app.handle(new Request('http://localhost/agent/list'))
            expect(response.status).toBe(200)
            const list = await response.json()
            expect(list.map(item => item.name)).toContain('build')
            expect(list.map(item => item.name)).toContain('review')
            expect(list.find(item => item.name === 'review').description).toBe('只读审查')
        })
    })
})
