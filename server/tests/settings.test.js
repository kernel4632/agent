/*
 * 会话运行设置测试：模式（plan / build）、按类别的自动批准、能力开关。
 *
 * 这三项都会改变 agent 实际拿到的东西（工具表、config），所以每条都要真的读回
 * 建好的 Agent 来验证，而不是只看接口返回了什么。
 * 自动批准要能一类一类地开关：开着"读取"不等于放行"写入"和"命令"，
 * 所以每条用例都同时看"这一类过没过"和"别类是不是还在问"。
 * 每个测试在自己的临时数据目录里跑，互不影响。
 * 运行：cd server && bun test
 */
import { describe, expect, test } from 'bun:test'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import Approval from '../features/approval.js'
import Config from '../commands/config.js'
import Path from '../utils/path.js'
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
// extra 用来补配置里要多出来的部分（比如 MCP 服务），默认的权限规则是"全部先问"。
const newSession = async ({ title = '设置测试', extra = {} } = {}) => {
    await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'ask' }, ...extra })
    const { sessionId } = await Session.create({ title })
    return sessionId
}

// 看某个会话当前建出来的 Agent 手里有哪些工具。
const toolNames = sessionId => Object.keys(Store.agents.get(sessionId).tools.schema).sort()

/*
 * 走一次审批，返回这次是直接放行还是要问用户。
 * 需要问的时候这里替用户拒绝掉，把那条等待解开——不然它会一直挂着，测试也看不出结果。
 */
const runCheck = async ({ sessionId, toolCallId, toolName, input = {} }) => {
    const result = Approval.check({ sessionId, toolCallId, toolName, input })
    // 要问的时候这条审批会同步进队列，所以这一步立刻就能看出来。
    const asked = Store.approvals.has(`${sessionId}:${toolCallId}`)
    if (asked) await Approval.decide({ sessionId, toolCallId, decision: 'deny' })
    return { allowed: await result, asked }
}

describe('会话运行设置', () => {
    test('默认是 build 模式、四类自动批准全关、能力全开', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            const settings = await Session.readSettings({ sessionId })
            // 默认值要和 agent-core 的默认一致，做到"默认全原生"。
            expect(settings).toEqual({
                mode: 'build',
                autoApprove: { read: false, write: false, command: false, mcp: false },
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

describe('自动批准按类别开关', () => {
    test('默认四类全关，读文件也要先问', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            // 规则是 ask；四类都没开，所以这次调用进等待队列。
            const check = await runCheck({ sessionId, toolCallId: 'call-1', toolName: 'file_read', input: { path: 'D:/app/a.js' } })
            expect(check).toEqual({ allowed: false, asked: true })
        })
    })

    test('只开读取：读文件直接过，写文件和命令照样要问', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await Session.saveSettings({ sessionId, autoApprove: { read: true } })

            expect(await runCheck({ sessionId, toolCallId: 'r1', toolName: 'file_read', input: { path: 'D:/app/a.js' } }))
                .toEqual({ allowed: true, asked: false })
            // 这是"细颗粒度"的关键：开了读取不该顺带把写入和命令也放行。
            expect(await runCheck({ sessionId, toolCallId: 'w1', toolName: 'file_write', input: { path: 'D:/app/b.js', content: 'x' } }))
                .toEqual({ allowed: false, asked: true })
            expect(await runCheck({ sessionId, toolCallId: 'c1', toolName: 'shell', input: { command: 'rm -rf build' } }))
                .toEqual({ allowed: false, asked: true })
        })
    })

    test('只开写入：改文件的工具直接过，读取和命令照样要问', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await Session.saveSettings({ sessionId, autoApprove: { write: true } })

            // edit 和 apply_patch 和 file_write 是同一类，开一个就都过。
            expect(await runCheck({ sessionId, toolCallId: 'w1', toolName: 'file_write', input: { path: 'D:/app/b.js', content: 'x' } }))
                .toEqual({ allowed: true, asked: false })
            expect(await runCheck({ sessionId, toolCallId: 'w2', toolName: 'edit', input: { path: 'D:/app/b.js', oldText: 'x', newText: 'y' } }))
                .toEqual({ allowed: true, asked: false })
            expect(await runCheck({ sessionId, toolCallId: 'r1', toolName: 'file_read', input: { path: 'D:/app/a.js' } }))
                .toEqual({ allowed: false, asked: true })
            expect(await runCheck({ sessionId, toolCallId: 'c1', toolName: 'shell', input: { command: 'ls' } }))
                .toEqual({ allowed: false, asked: true })
        })
    })

    test('只开命令：命令直接过，它改的文件因此也没人问——所以命令要单独一个开关', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await Session.saveSettings({ sessionId, autoApprove: { command: true } })

            expect(await runCheck({ sessionId, toolCallId: 'c1', toolName: 'shell', input: { command: 'bun test' } }))
                .toEqual({ allowed: true, asked: false })
            expect(await runCheck({ sessionId, toolCallId: 'w1', toolName: 'file_write', input: { path: 'D:/app/b.js', content: 'x' } }))
                .toEqual({ allowed: false, asked: true })
        })
    })

    test('MCP 工具按服务名归类，开 MCP 只放行 MCP 工具', async () => {
        await withHome(async () => {
            const sessionId = await newSession({ extra: { mcp: { everything: { command: 'bun', args: [] } } } })
            await Session.saveSettings({ sessionId, autoApprove: { mcp: true } })

            // 配置里有 everything 这个服务，带这个前缀的工具就归 MCP 那一类。
            expect(await runCheck({ sessionId, toolCallId: 'm1', toolName: 'everything_echo', input: { message: 'hi' } }))
                .toEqual({ allowed: true, asked: false })
            expect(await runCheck({ sessionId, toolCallId: 'r1', toolName: 'file_read', input: { path: 'D:/app/a.js' } }))
                .toEqual({ allowed: false, asked: true })
        })
    })

    test('名字撞上服务名前缀、但配置里没有这个服务时，不算 MCP，照样要问', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await Session.saveSettings({ sessionId, autoApprove: { mcp: true } })

            // 用户自己写了一个叫 everything_echo 的工具，它不是 MCP 服务给的。
            // 光看名字认不出，所以要拿配置里的服务名比一次，比不中就按未分类处理。
            expect(await runCheck({ sessionId, toolCallId: 'u1', toolName: 'everything_echo', input: {} }))
                .toEqual({ allowed: false, asked: true })
        })
    })

    test('认不出类别的工具一律要问，四类全开也一样', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await Session.saveSettings({ sessionId, autoApprove: { read: true, write: true, command: true, mcp: true } })

            // 用户自己放进去的工具没人给它分类，不能因为"不知道它是什么"就替用户放行。
            expect(await runCheck({ sessionId, toolCallId: 'u1', toolName: '我写的脚本', input: { run: true } }))
                .toEqual({ allowed: false, asked: true })
        })
    })

    test('随时可以一类一类地改，改一类不动别类', async () => {
        await withHome(async () => {
            const sessionId = await newSession()

            // 先只开读取。
            let settings = await Session.saveSettings({ sessionId, autoApprove: { read: true } })
            expect(settings.autoApprove).toEqual({ read: true, write: false, command: false, mcp: false })

            // 再加开命令：读取那一位不能被动到。
            settings = await Session.saveSettings({ sessionId, autoApprove: { command: true } })
            expect(settings.autoApprove).toEqual({ read: true, write: false, command: true, mcp: false })

            // 关掉读取：命令和其余几位照旧。
            settings = await Session.saveSettings({ sessionId, autoApprove: { read: false } })
            expect(settings.autoApprove).toEqual({ read: false, write: false, command: true, mcp: false })
            expect(await runCheck({ sessionId, toolCallId: 'r1', toolName: 'file_read', input: { path: 'D:/app/a.js' } }))
                .toEqual({ allowed: false, asked: true })
            expect(await runCheck({ sessionId, toolCallId: 'c1', toolName: 'shell', input: { command: 'ls' } }))
                .toEqual({ allowed: true, asked: false })
        })
    })

    test('任务跑着的时候也能改自动批准，当场生效', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            // 模拟"模型正在干活"：只把 running 标上，不真的起一轮请求。
            Store.agents.get(sessionId).running = true

            // 看到模型在乱改文件时，用户要能当场把"写入"关掉，而不是先停下来再改。
            // 自动批准是审批时现读设置的，不用重建 Agent，所以不受 running 限制。
            const settings = await Session.saveSettings({ sessionId, autoApprove: { write: false } })
            expect(settings.autoApprove.write).toBe(false)
            expect(await runCheck({ sessionId, toolCallId: 'w1', toolName: 'file_write', input: { path: 'D:/app/b.js', content: 'x' } }))
                .toEqual({ allowed: false, asked: true })

            // 反过来也能开：任务跑着的时候把读取放开。
            const opened = await Session.saveSettings({ sessionId, autoApprove: { read: true } })
            expect(opened.autoApprove.read).toBe(true)
            expect(await runCheck({ sessionId, toolCallId: 'r1', toolName: 'file_read', input: { path: 'D:/app/a.js' } }))
                .toEqual({ allowed: true, asked: false })
        })
    })

    test('任务跑着的时候不许换模式，否则工具表会在半路被换掉', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            Store.agents.get(sessionId).running = true
            await expect(Session.saveSettings({ sessionId, mode: 'plan' })).rejects.toThrow(/already running/i)
            // 被拒的改动不该留在磁盘上。
            expect((await Settings.read({ sessionId })).mode).toBe('build')
        })
    })

    test('界面传了认不出的类别名时不存进去，只认那四类', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            const settings = await Session.saveSettings({ sessionId, autoApprove: { read: true, 乱写: true } })
            expect(settings.autoApprove).toEqual({ read: true, write: false, command: false, mcp: false })
        })
    })

    test('老版本设置文件里的那个总开关还能读，摊到每一类上', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            // 上一版只有一个 autoApprove 布尔。用户升级后不该发现自己的设置丢了。
            await writeFile(Path.settings(sessionId), JSON.stringify({
                mode: 'build',
                autoApprove: true,
                capabilities: { image: true, cache: true, stream: true },
            }))
            Store.settings.clear()

            const settings = await Session.readSettings({ sessionId })
            expect(settings.autoApprove).toEqual({ read: true, write: true, command: true, mcp: true })
        })
    })

    test('自动批准不能绕过忽略规则', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await Session.saveSettings({ sessionId, autoApprove: { read: true } })
            // 自动批准省掉的是"问一遍"，不是把 .agentignore 也一起关掉。
            const check = await runCheck({ sessionId, toolCallId: 'call-3', toolName: 'file_read', input: { path: 'D:/app/.env' } })
            expect(check).toEqual({ allowed: false, asked: false })
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

    test('界面上点一个类别的开关就走一个 PATCH', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            const response = await app.handle(new Request(`http://localhost/session/settings/${sessionId}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ autoApprove: { read: true } }),
            }))
            expect(response.status).toBe(200)
            expect((await response.json()).autoApprove).toEqual({ read: true, write: false, command: false, mcp: false })
        })
    })

    test('读取会话时会带上当前设置，界面不用再单独问一次', async () => {
        await withHome(async () => {
            const sessionId = await newSession()
            await Session.saveSettings({ sessionId, mode: 'plan', autoApprove: { read: true } })
            const session = await Session.read({ sessionId })
            expect(session.settings).toMatchObject({
                mode: 'plan',
                autoApprove: { read: true, write: false, command: false, mcp: false },
            })
        })
    })
})
