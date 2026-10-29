/*
 * 会话运行设置测试：思考强度、压缩阈值、按任务的模型和会话分支。
 *
 * 每一项都要真的读回装配好的 Agent 来验证，而不是只看接口返回了什么。
 * 每个测试在自己的临时数据目录里跑，互不影响。
 * 运行：cd server && bun test
 */
import { describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import AgentCore from '@kernel4632/agent-core'
import Agent from '../features/agent.js'
import Approval from '../features/approval.js'
import Settings from '../commands/settings.js'
import Delegation from '../tools/subagent.js'
import History from '../features/history.js'
import Session from '../commands/session.js'
import store from '../store.js'
import Title from '../features/title.js'
import { app } from '../server.js'


const withHome = async callback => {
    const root = join(tmpdir(), `agent-settings-${crypto.randomUUID()}`)
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

const newSession = async ({ title = '设置测试', extra = {} } = {}) => {
    await Settings.set({ providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'ask' }, ...extra })
    const { sessionId } = await Session.create({ title })
    return sessionId
}

const toolNames = sessionId => Object.keys(Agent.runtime().get(sessionId).tools.schema).sort()


describe('会话运行设置', () => {
    test('默认设置只有思考强度', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            expect(await Session.readSettings({ sessionId })).toEqual({
                reasoning: 'auto',
            })
        })
    })

    test('思考强度保存七档，写错时保持原值', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            expect((await Session.saveSettings({ sessionId, reasoning: 'high' })).reasoning).toBe('high')
            expect(Agent.runtime().get(sessionId).config.provider.body.reasoning_effort).toBe('high')
            expect((await Session.saveSettings({ sessionId, reasoning: 'ultra' })).reasoning).toBe('high')
        })
    })

    test('主 Agent 使用全部工具，不按角色裁剪', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            const names = toolNames(sessionId)
            expect(names).toContain('write_to_file')
            expect(names).toContain('execute_command')
            expect(names).toContain('apply_patch')
            expect(names).toContain('read_file')
            expect(names).toContain('new_task')
        })
    })

    test('设置存到会话目录里，换一个进程读回来还是同一份', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await Session.saveSettings({ sessionId, reasoning: 'high' })

            // 清掉内存缓存，强制从磁盘读，模拟后端重启。
            History.clear()
            Agent.runtime().clear()
            const reloaded = await Session.readSettings({ sessionId })
            expect(reloaded.reasoning).toBe('high')
        })
    })

    test('子任务上带了审批回调，而且回的是同一个会话', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            const calls = []
            const original = AgentCore.create
            AgentCore.create = options => { calls.push(options); return original(options) }
            try {
                const taskTool = Delegation.build({
                    config: {},
                    tools: Agent.runtime().get(sessionId).tools,
                    sessionId,
                    onPermission: Approval.check,   // 审批回到这条测试会话
                })
                await taskTool.execute({ description: '查一下', prompt: '查一下' }, {}).catch(() => {})
            } finally {
                AgentCore.create = original
            }

            const callbacks = calls[0]?.callbacks
            expect(typeof callbacks?.onPermission).toBe('function')
            // 子任务审批回到主会话：用户能在界面上看到并拒绝它。
            const pending = Approval.check({ sessionId, toolCallId: 'sub-1', toolName: 'execute_command', input: { command: 'ls' } })
            await Bun.sleep(0)
            expect(Approval.pending(sessionId)).toHaveLength(1)
            await Approval.decide({ sessionId, toolCallId: 'sub-1', decision: 'deny' })
            expect(await pending).toBe(false)
        })
    })

})


describe('哪件事用哪个模型', () => {
    test('不点名时压缩和标题都跟对话模型走', async () => {
        await withHome(async () => {
            await newSession()
            expect(Agent.taskModel('compact')).toEqual({ provider: 'local', model: 'model' })
            expect(Agent.taskModel('title')).toEqual({ provider: 'local', model: 'model' })
            expect(Agent.taskModel('task')).toEqual({ provider: 'local', model: 'model' })
        })
    })

    test('给压缩单独配一个模型时，真的写进 agent-core 的 config.compact', async () => {
        await withHome(async () => {
            await Settings.set({
                providers: [
                    { name: 'local', models: ['主模型'] },
                    { name: 'cheap', models: ['小模型'] },
                ],
                permission: { '*': 'ask' },
                models: { compact: { provider: 'cheap', model: '小模型' } },
            })
            const { sessionId } = await Session.create({ title: '分开配模型' })
            const { config } = Agent.runtime().get(sessionId)
            expect(config.compact.model).toBe('小模型')
            expect(config.compact.system).toBeUndefined()
            expect(config.compact.maxContextTokens).toBeUndefined()
            expect(config.model).toBe('主模型')
        })
    })

    test('标题和子任务可以单独配，互不影响', async () => {
        await withHome(async () => {
            await Settings.set({
                providers: [{ name: 'local', models: ['主模型', '标题模型', '任务模型'] }],
                permission: { '*': 'ask' },
                models: {
                    title: { provider: 'local', model: '标题模型' },
                    task: { provider: 'local', model: '任务模型' },
                },
            })
            expect(Agent.taskModel('title')).toEqual({ provider: 'local', model: '标题模型' })
            expect(Agent.taskModel('task')).toEqual({ provider: 'local', model: '任务模型' })
            expect(Agent.taskModel('compact')).toEqual({ provider: 'local', model: '主模型' })
        })
    })

    test('清空某一项表示改回和对话模型共用', async () => {
        await withHome(async () => {
            await Settings.set({
                providers: [{ name: 'local', models: ['主模型', '小模型'] }],
                models: { compact: { provider: 'local', model: '小模型' } },
            })
            await Settings.set({
                providers: [{ name: 'local', models: ['主模型', '小模型'] }],
                models: { compact: { provider: '', model: '' } },
            })
            expect(Agent.taskModel('compact')).toEqual({ provider: 'local', model: '主模型' })
        })
    })
})

describe('压缩阈值', () => {
    test('自动压缩阈值可改，写错时保持原值', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: ['model'] }], compact: { threshold: 0.6 } })
            const { sessionId } = await Session.create({ title: '阈值' })
            expect(Agent.runtime().get(sessionId).config.compactThreshold).toBe(0.6)

            await Settings.set({ providers: [{ name: 'local', models: ['model'] }], compact: { threshold: 1.5 } })
            History.clear()
            Agent.runtime().clear()
            expect((await Session.read({ sessionId })).id).toBe(sessionId)
            expect(Agent.threshold()).toBe(0.8)
        })
    })


})

describe('自动生成标题', () => {
    test('模型回的东西被收拾成能直接当标题的样子', async () => {
        expect(Title.clean('"修复登录跳转"')).toBe('修复登录跳转')
        expect(Title.clean('标题：修复登录跳转')).toBe('修复登录跳转')
        expect(Title.clean('修复登录跳转。')).toBe('修复登录跳转')
        expect(Title.clean('修复登录跳转\n这句是解释，不该进来')).toBe('修复登录跳转')
        expect(Title.clean('《修复登录跳转》')).toBe('修复登录跳转')
        expect(Title.clean('一'.repeat(80)).length).toBe(Title.MAX_LENGTH)
        expect(Title.clean('')).toBe('')
    })

    test('模型连不上时返回 null，不把这一轮弄挂', async () => {
        await withHome(async () => {
            const title = await Title.generate({
                connection: { baseURL: 'http://127.0.0.1:1/v1', model: 'x', protocol: 'chat' },
                messages: [{ role: 'user', content: '帮我看看这个文件为什么读不了' }],
            })
            expect(title).toBeNull()
        })
    })

    test('起不出标题时用用户第一句话兜底', () => {
        expect(Title.fallback([{ role: 'user', content: '帮我看看这个文件为什么读不了' }])).toBe('帮我看看这个文件为什么读')
    })
})

describe('会话模型切换', () => {
    test('改供应商和模型后，元信息和 Agent 的 config 都跟着换', async () => {
        await withHome(async () => {
            await Settings.set({
                providers: [
                    { name: 'local', models: ['first', 'second'] },
                    { name: 'other', models: ['third'] },
                ],
            })
            const { sessionId } = await Session.create({ title: 'Switch model' })

            const meta = await Session.setModel({ sessionId, provider: 'other', model: 'third' })
            expect(meta.provider).toBe('other')
            expect(meta.model).toBe('third')
            expect((await Session.read({ sessionId })).model).toBe('third')
            expect(Agent.runtime().get(sessionId).config.model).toBe('third')
        })
    })

    test('供应商不存在时按填错处理，不改动原模型', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await expect(Session.setModel({ sessionId, provider: 'missing', model: 'x' })).rejects.toMatchObject({ status: 400 })
            expect((await Session.read({ sessionId })).model).toBe('model')
        })
    })

    test('任务运行中不能切换模型', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            Agent.runtime().get(sessionId).running = true
            await expect(Session.setModel({ sessionId, provider: 'local', model: 'other' })).rejects.toMatchObject({ status: 409 })
            Agent.runtime().get(sessionId).running = false
        })
    })

    test('HTTP 接口能切换模型', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            const response = await app.handle(new Request(`http://localhost/session/model/${sessionId}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ provider: 'local', model: 'other' }),
            }))
            expect(response.status).toBe(200)
            expect((await response.json()).model).toBe('other')
        })
    })
})

describe('会话分支', () => {
    test('分支复制历史和运行设置', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await History.add({ sessionId, message: AgentCore.history.user({ content: '第一句' }) })
            await History.add({ sessionId, message: AgentCore.history.assistant({ content: '第二句' }) })
            await History.save(sessionId)
            await Session.saveSettings({ sessionId, reasoning: 'high' })

            const { sessionId: branchId } = await Session.fork({ sessionId })
            expect(branchId).not.toBe(sessionId)

            const branch = await Session.read({ sessionId: branchId })
            expect(branch.title).toBe('设置测试（分支）')
            expect(branch.history).toHaveLength(2)
            expect(branch.settings.reasoning).toBe('high')
            expect(branch.cwd).toBe(process.cwd())
        })
    })

    test('可以只分支到某条消息', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            const first = await History.add({ sessionId, message: AgentCore.history.user({ content: '只留这一句' }) })
            await History.add({ sessionId, message: AgentCore.history.assistant({ content: '后面这句不要' }) })
            await History.save(sessionId)

            const { sessionId: branchId } = await Session.fork({ sessionId, messageId: first.messageId })
            const branch = await Session.read({ sessionId: branchId })
            expect(branch.history).toHaveLength(1)
            expect(branch.history[0].content).toBe('只留这一句')
        })
    })

    test('消息不存在时按填错处理', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await expect(Session.fork({ sessionId, messageId: 'missing' })).rejects.toMatchObject({ status: 404 })
        })
    })

    test('HTTP 接口能创建分支', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            const response = await app.handle(new Request(`http://localhost/session/fork/${sessionId}`, { method: 'POST' }))
            expect(response.status).toBe(200)
            const { sessionId: branchId } = await response.json()
            expect(branchId).not.toBe(sessionId)
        })
    })
})

describe('设置接口', () => {
    test('读设置和改设置都能通过 HTTP 走通', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            const request = (path, options) => app.handle(new Request(`http://localhost${path}`, options))

            const initial = await request(`/session/settings/${sessionId}`)
            expect(initial.status).toBe(200)
            expect((await initial.json()).reasoning).toBe('auto')

            const saved = await request(`/session/settings/${sessionId}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ reasoning: 'high' }),
            })
            expect(saved.status).toBe(200)
            expect((await saved.json()).reasoning).toBe('high')
        })
    })

    test('读取会话时会带上当前设置', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await Session.saveSettings({ sessionId, reasoning: 'high' })
            const session = await Session.read({ sessionId })
            expect(session.settings).toEqual({ reasoning: 'high' })
        })
    })
})
