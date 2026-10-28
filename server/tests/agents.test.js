/*
 * 智能体层测试：内置智能体、角色工具裁剪和会话设置迁移。
 * 每个测试在自己的临时数据目录里跑，互不影响。
 * 运行：cd server && bun test
 */
import { describe, expect, test } from 'bun:test'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Agent from '../features/agent.js'
import Config from '../commands/config.js'
import Path from '../utils/path.js'
import Session from '../commands/session.js'
import History from '../features/history.js'
import store from '../store.js'

const withHome = async callback => {
    const root = join(tmpdir(), `agent-agents-${crypto.randomUUID()}`)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    Object.keys(store.config).forEach(key => delete store.config[key])
    Agent.runtime().clear()
    History.clear()
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
        ...extra,
    })
    const { sessionId } = await Session.create({ title: '智能体测试' })
    return sessionId
}

const toolNames = sessionId => Object.keys(Agent.runtime().get(sessionId).tools.schema).sort()

describe('智能体定义', () => {
    test('内置执行、计划、问答、调试四个智能体', async () => {
        await withHome(async () => {
            const names = Agent.list({}).map(item => item.name)
            expect(names).toEqual(['build', 'plan', 'ask', 'debug'])
            expect(Agent.find('ask').readOnly).toBe(true)
            expect(Agent.find('build').readOnly).toBe(false)
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

    test('新会话使用配置里的对话默认模型', async () => {
        await withHome(async () => {
            await Config.set({
                providers: [{ name: 'local', models: ['main', 'agent-model'] }],
                permission: { '*': 'ask' },
                models: { chat: { provider: 'local', model: 'agent-model' } },
                compact: { threshold: 0.6 },
            })
            const { sessionId } = await Session.create({ title: '全局默认值' })
            expect((await Session.read({ sessionId })).model).toBe('agent-model')
            expect(Agent.runtime().get(sessionId).config.compactThreshold).toBe(0.6)
        })
    })

    test('旧设置文件里的 mode 会迁移成 agent', async () => {
        await withHome(async () => {
            const sessionId = await configure()
            const path = Path.settings(sessionId)
            await writeFile(path, JSON.stringify({
                mode: 'plan',
                autoApprove: { read: true },
            }))
            History.clear()
            const settings = await Session.readSettings({ sessionId })
            expect(settings.agent).toBe('plan')
            expect(settings.mode).toBeUndefined()
            expect(settings.autoApprove.read).toBe(true)
            expect(settings.capabilities).toBeUndefined()
            expect(store.sessions[sessionId].settings.capabilities).toBeUndefined()
        })
    })

    test('写错智能体名按填错处理', async () => {
        await withHome(async () => {
            const sessionId = await configure()
            await expect(Session.saveSettings({ sessionId, agent: 'nope' })).rejects.toMatchObject({ status: 400 })
            expect((await Session.readSettings({ sessionId })).agent).toBe('build')
        })
    })

})
