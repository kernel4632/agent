/*
 * 会话运行设置测试：模式（plan / build）、自动批准、能力开关。
 *
 * 这三项都会改变 agent 实际拿到的东西（工具表、config），所以每条都要真的读回
 * 建好的 Agent 来验证，而不是只看接口返回了什么。
 * 每个测试在自己的临时数据目录里跑，互不影响。
 * 运行：cd server && bun test
 */
import { describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import Approval from '../features/approval.js'
import Config from '../commands/config.js'
import Settings from '../commands/settings.js'
import Session from '../commands/session.js'
import Store from '../store.js'
import { app } from '../server.js'

// 每个测试使用独立目录和干净的内存数据。
const withHome = async callback => {
    const root = join(tmpdir(), `agent-settings-${crypto.randomUUID()}`)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    Object.keys(Store.config).forEach(key => delete Store.config[key])
    Store.agents.clear()
    Store.sessions.clear()
    Store.snapshots.clear()
    Store.approvals.clear()
    Store.settings.clear()
    try {
        return await callback(root)
    } finally {
        if (previousHome === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previousHome
        await rm(root, { recursive: true, force: true })
    }
}

// 直接建一条会话，省得每个测试重复写。
const newSession = async (title = '设置测试') => {
    await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'ask' } })
    const { sessionId } = await Session.create({ title })
    return sessionId
}

// 看某个会话当前建出来的 Agent 手里有哪些工具。
const toolNames = sessionId => Object.keys(Store.agents.get(sessionId).tools.schema).sort()

describe('会话运行设置', () => {
    test('默认是 build 模式、不开自动批准、能力全开', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            const settings = await Session.readSettings({ sessionId })
            // 默认值要和 agent-core 的默认一致，做到"默认全原生"。
            expect(settings).toEqual({
                mode: 'build',
                autoApprove: false,
                capabilities: { image: true, cache: true, stream: true },
            })
        })
    })

    test('plan 模式只给只读工具，build 模式给全套', async () => {
        await withHome(async () => {
            const sessionId = await newSession()

            // build 模式下能改文件的工具都在。
            const buildTools = toolNames(sessionId)
            expect(buildTools).toContain('file_write')
            expect(buildTools).toContain('shell')
            expect(buildTools).toContain('apply_patch')

            // 切到 plan 之后，能改文件的工具一个都不该剩下。
            await Session.saveSettings({ sessionId, mode: 'plan' })
            const planTools = toolNames(sessionId)
            expect(planTools).not.toContain('file_write')
            expect(planTools).not.toContain('edit')
            expect(planTools).not.toContain('apply_patch')
            expect(planTools).not.toContain('shell')
            // 看和查的工具要留着，不然 plan 模式什么都干不了。
            expect(planTools).toContain('file_read')
            expect(planTools).toContain('grep')
            expect(planTools).toContain('glob')

            // 切回 build 又能改文件了。
            await Session.saveSettings({ sessionId, mode: 'build' })
            expect(toolNames(sessionId)).toContain('file_write')
        })
    })

    test('plan 模式不通过系统提示词约束，system 始终是用户原样', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await Session.saveSettings({ sessionId, mode: 'plan' })
            // 靠的是不给写工具，而不是往提示词里写"请不要改文件"。
            // 用户没写提示词时 system 就得是空串，不能有任何注入。
            expect(Store.agents.get(sessionId).config.system).toBe('')
        })
    })

    test('模式名写错时按填错处理，不改动已有设置', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await expect(Session.saveSettings({ sessionId, mode: 'hacker' })).rejects.toThrow(/must be plan or build/i)
            // 坏输入不能把设置改坏，也不能留下半个状态。
            expect((await Session.readSettings({ sessionId })).mode).toBe('build')
        })
    })

    test('设置存到会话目录里，换一个进程读回来还是同一份', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await Session.saveSettings({ sessionId, mode: 'plan', capabilities: { image: false } })

            // 清掉内存缓存，强制从磁盘读，模拟后端重启。
            Store.settings.clear()
            const reloaded = await Session.readSettings({ sessionId })
            expect(reloaded.mode).toBe('plan')
            expect(reloaded.capabilities.image).toBe(false)
            // 没点名的那几项保持默认。
            expect(reloaded.capabilities.cache).toBe(true)
            expect(reloaded.capabilities.stream).toBe(true)
        })
    })

    test('能力开关会真的写进交给 agent-core 的 config', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await Session.saveSettings({ sessionId, capabilities: { image: false, cache: false, stream: false } })

            const { config } = Store.agents.get(sessionId)
            // 这三项都直接对应 agent-core 的字段名，不做二次翻译。
            expect(config.capabilities.image).toBe(false)
            expect(config.cache).toBe(false)
            expect(config.stream).toBe(false)
        })
    })
})

describe('自动批准', () => {
    test('开着自动批准时不再弹审批，工具直接放行', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            // 规则是 ask：不开自动批准时应当进等待队列。
            Store.settings.set(sessionId, { ...Settings.DEFAULTS, autoApprove: false })
            const waiting = Approval.check({ sessionId, toolCallId: 'call-1', toolName: 'file_read', input: { path: 'D:/app/a.js' } })
            expect(Approval.pending(sessionId)).toHaveLength(1)
            // 收尾：把那条审批拒掉，免得留在全局表里影响后面的测试。
            await Approval.decide({ sessionId, toolCallId: 'call-1', decision: 'deny' })
            expect(await waiting).toBe(false)

            // 开着自动批准，同样的调用直接过。
            Store.settings.set(sessionId, { ...Settings.DEFAULTS, autoApprove: true })
            expect(await Approval.check({ sessionId, toolCallId: 'call-2', toolName: 'file_read', input: { path: 'D:/app/a.js' } })).toBe(true)
            expect(Approval.pending(sessionId)).toHaveLength(0)
        })
    })

    test('自动批准不能绕过忽略规则', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            Store.settings.set(sessionId, { ...Settings.DEFAULTS, autoApprove: true })
            // 自动批准省掉的是"问一遍"，不是把 .agentignore 也一起关掉。
            expect(await Approval.check({ sessionId, toolCallId: 'call-3', toolName: 'file_read', input: { path: 'D:/app/.env' } })).toBe(false)
        })
    })

    test('开关可以随时改，不要求先停任务', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            // 改这两个字段不影响工具表和历史，所以不需要重建 Agent。
            const settings = await Session.saveSettings({ sessionId, autoApprove: true })
            expect(settings.autoApprove).toBe(true)
            expect(Store.settings.get(sessionId).autoApprove).toBe(true)
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
            expect((await initial.json()).mode).toBe('build')

            const saved = await request(`/session/settings/${sessionId}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ mode: 'plan' }),
            })
            expect(saved.status).toBe(200)
            expect((await saved.json()).mode).toBe('plan')

            // 模式名写错时返回 400 而不是 500——这是用户填错。
            const bad = await request(`/session/settings/${sessionId}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ mode: 'nope' }),
            })
            expect(bad.status).toBe(400)
        })
    })

    test('读取会话时会带上当前设置，界面不用再单独问一次', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await Session.saveSettings({ sessionId, mode: 'plan', autoApprove: true })
            const session = await Session.read({ sessionId })
            expect(session.settings).toMatchObject({ mode: 'plan', autoApprove: true })
        })
    })
})
