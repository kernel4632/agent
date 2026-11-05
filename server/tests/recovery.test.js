/*
 * 重启恢复：后端重启后自动接住被打断的任务。
 *
 * 崩溃时进程里的运行状态全丢，磁盘 meta 上的 running 标记是唯一线索。
 * 这里用假 Agent 检查：标记怎么写、哪些会话会被自动续跑、哪些只清标记。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import Chat from '../commands/chat.js'
import Path from '../utils/path.js'
import Settings from '../commands/settings.js'
import History from '../features/history.js'
import Session from '../commands/session.js'
import Agent from '../features/agent.js'
import store from '../store.js'
import SSE from '../utils/sse.js'
import { app } from '../server.js'

const homes = []
const withHome = async callback => {
    const root = join(tmpdir(), `agent-recovery-${crypto.randomUUID()}`)
    homes.push(root)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    Path.lock(root)   // 锁定数据目录：晚到的异步收尾不会落到真实 ~/.agent
    Object.keys(store.config).forEach(key => delete store.config[key])
    Agent.runtime().clear()
    History.clear()
    // 护栏：测试绝不能在真实数据目录里留下任何东西。
    const real = join(process.env.USERPROFILE || process.env.HOME || '', '.agent')
    if (root === real) throw new Error('测试把 AGENT_HOME 指到了真实数据目录')
    try {
        return await callback(root)
    } finally {
        // 先停掉这个测试留下的活 Agent，再恢复环境：收尾写盘必须在原目录里完成。
        // 必须带超时：有些测试的假 Agent 故意让 stop() 永不 resolve，直接 await 会挂死整个跑批。
        for (const [, agent] of Agent.runtime()) {
            await Promise.race([agent.stop?.().catch(() => {}), Bun.sleep(500)])
        }
        await Bun.sleep(50)
        Agent.runtime().clear()
        Path.unlock()
        if (previousHome === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previousHome
    }
}

afterEach(async () => {
    await Promise.all(homes.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

// withHome 会清空 store.config，供应商要进家目录之后再设置。
const setup = async () => {
    await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }], baseURL: 'http://127.0.0.1:9/v1' }] })
    const { sessionId } = await Session.create({ title: '恢复测试' })
    return sessionId
}

const text = value => [{ type: 'text', text: value }]

// 等磁盘 meta 上的运行标记变成期望值，避免异步落盘还没写完就断言。
// 目录一律从 Path.root() 取（已锁定），不读 process.env：并发跑测试时别的文件会改 env。
const waitForRunning = async (sessionId, expected) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const meta = await Bun.file(join(Path.root(), 'sessions', sessionId, 'meta.json')).json().catch(() => null)
        if (meta && (meta.running === true) === expected) return meta
        await Bun.sleep(10)
    }
    throw new Error(`meta.json 上的 running 迟迟没有变成 ${expected}`)
}

// 造一个假 Agent：resume 记录被调用，结束后由 run 的收尾清标记。
const fakeAgent = ({ history, resumePlan }) => {
    const agent = {
        history,
        running: null,
        stop: async () => ({ ok: true }),
    }
    if (resumePlan) {
        agent.resume = async options => {
            await options.callbacks.onStart()
            return await resumePlan()
        }
    }
    return agent
}

// 等一次 run 的收尾落盘（历史文件包含期望条数），恢复流程才算完整走完。
const waitForHistory = async (sessionId, count) => {
    const path = join(Path.root(), 'sessions', sessionId, 'history.json')
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const saved = await Bun.file(path).json().catch(() => null)
        if (saved && (saved.messages?.length || 0) >= count) return
        await Bun.sleep(10)
    }
}

describe('运行标记', () => {
    test('开跑落盘 running，正常结束清掉', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            const agent = fakeAgent({
                history: [{ id: 'a0', role: 'assistant', content: text('做到一半') }],
                resumePlan: async () => {
                    agent.history.push({ id: 'a1', role: 'assistant', content: text('续上了') })
                    return { reason: 'finished' }
                },
            })
            Agent.runtime().set(sessionId, agent)
            const stream = await SSE.connect({ id: sessionId, request: new Request('http://localhost/sse') })

            expect(await Chat.resume({ sessionId })).toEqual({ ok: true })
            const startedMeta = await waitForRunning(sessionId, true)
            expect(startedMeta.running).toBe(true)

            const events = []
            const reader = stream.body.getReader()
            const decoder = new TextDecoder()
            for (let attempt = 0; attempt < 100; attempt += 1) {
                const chunk = await Promise.race([reader.read(), Bun.sleep(1000).then(() => null)])
                if (!chunk || chunk.done) break
                for (const packet of decoder.decode(chunk.value, { stream: true }).split('\n\n')) {
                    const data = packet.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
                    if (data) events.push(JSON.parse(data))
                }
                if (events.some(event => event.type === 'agent-finish')) break
            }
            await SSE.close({ id: sessionId })
            await waitForHistory(sessionId, 2)
            await waitForRunning(sessionId, false)

            const meta = await Bun.file(join(Path.root(), 'sessions', sessionId, 'meta.json')).json()
            expect(meta.running).toBeUndefined()
            expect(History.get({ sessionId }).map(message => message.id)).toEqual(['a0', 'a1'])
        })
    })

    test('任务失败也会清掉运行标记', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            const agent = fakeAgent({
                history: [{ id: 'a1', role: 'assistant', content: text('做到一半') }],
                resumePlan: () => { throw new Error('恢复时模型请求失败') },
            })
            Agent.runtime().set(sessionId, agent)
            const stream = await SSE.connect({ id: sessionId, request: new Request('http://localhost/sse') })
            expect(await Chat.resume({ sessionId })).toEqual({ ok: true })

            const reader = stream.body.getReader()
            const decoder = new TextDecoder()
            let events = ''
            for (let attempt = 0; attempt < 100; attempt += 1) {
                const chunk = await Promise.race([reader.read(), Bun.sleep(1000).then(() => null)])
                if (!chunk || chunk.done) break
                events += decoder.decode(chunk.value, { stream: true })
                if (events.includes('agent-finish')) break
            }
            await SSE.close({ id: sessionId })
            await Bun.sleep(100)

            const meta = await Bun.file(join(Path.root(), 'sessions', sessionId, 'meta.json')).json()
            expect(meta.running).toBeUndefined()
            expect(events).toContain('恢复时模型请求失败')
            expect(History.get({ sessionId }).map(message => message.id)).toEqual(['a1'])
        })
    })

    test('正常收尾的会话磁盘上不留 running', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            const agent = fakeAgent({ history: [] })
            agent.send = options => Promise.resolve().then(() => options.callbacks.onStart()).then(() => {
                agent.history.push({ id: 'u1', role: 'user', content: text(options.input) })
                agent.history.push({ id: 'a1', role: 'assistant', content: text('完成') })
                return { reason: 'finished' }
            })
            Agent.runtime().set(sessionId, agent)
            await Chat.send({ sessionId, input: '你好' })
            await waitForHistory(sessionId, 2)
            await Bun.sleep(100)

            const meta = await Bun.file(join(Path.root(), 'sessions', sessionId, 'meta.json')).json()
            expect(meta.running).toBeUndefined()
        })
    })
})

describe('重启恢复', () => {
    test('末尾是助手的运行中会话被自动续跑', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            await History.add({ sessionId, message: { id: 'a1', role: 'assistant', content: text('做到一半') } })
            History.setRunning(sessionId, true)
            await History.save(sessionId)
            History.remove({ sessionId })
            Agent.runtime().clear()

            const resumed = []
            const agent = fakeAgent({
                history: [{ id: 'a1', role: 'assistant', content: text('做到一半') }],
                resumePlan: async () => {
                    agent.history.push({ id: 'a2', role: 'assistant', content: text('续上了') })
                    resumed.push(sessionId)
                    return { reason: 'finished' }
                },
            })
            Agent.runtime().set(sessionId, agent)

            const { recovered } = await Chat.recover()
            expect(recovered).toEqual([sessionId])
            expect(resumed).toEqual([sessionId])
            await waitForHistory(sessionId, 2)
            await waitForRunning(sessionId, false)

            const meta = await Bun.file(join(Path.root(), 'sessions', sessionId, 'meta.json')).json()
            expect(meta.running).toBeUndefined()
            expect(History.get({ sessionId }).map(message => message.id)).toEqual(['a1', 'a2'])
        })
    })

    test('末尾悬着没结果的工具调用也照常续跑', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            await History.add({ sessionId, message: { id: 'u1', role: 'user', content: text('开始') } })
            await History.add({ sessionId, message: { id: 'a1', role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'shell', input: {} }] } })
            History.setRunning(sessionId, true)
            await History.save(sessionId)
            History.remove({ sessionId })
            Agent.runtime().clear()

            const agent = fakeAgent({
                history: [{ id: 'a1', role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'shell', input: {} }] }],
                resumePlan: async () => ({ reason: 'finished' }),
            })
            Agent.runtime().set(sessionId, agent)

            const { recovered } = await Chat.recover()
            expect(recovered).toEqual([sessionId])
        })
    })

    test('末尾是用户消息时只清标记，不启动任务', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            await History.add({ sessionId, message: { id: 'u1', role: 'user', content: text('我说的最后一句话') } })
            History.setRunning(sessionId, true)   // 模拟“任务开跑后还没产出助手回复就被重启”
            await History.save(sessionId)
            History.remove({ sessionId })
            Agent.runtime().clear()

            const agent = fakeAgent({ history: [{ id: 'u1', role: 'user', content: text('我说的最后一句话') }] })
            let resumeCalled = false
            agent.resume = () => { resumeCalled = true; return Promise.resolve({ reason: 'finished' }) }
            Agent.runtime().set(sessionId, agent)

            const { recovered } = await Chat.recover()
            expect(recovered).toEqual([])
            expect(resumeCalled).toBe(false)
            await Bun.sleep(100)

            const meta = await Bun.file(join(Path.root(), 'sessions', sessionId, 'meta.json')).json()
            expect(meta.running).toBeUndefined()
        })
    })

    test('任务其实已经正常收尾（有 attempt_completion 结果）时只清标记', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            await History.add({ sessionId, message: { id: 'u1', role: 'user', content: text('问题') } })
            await History.add({ sessionId, message: { id: 'a1', role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'attempt_completion', input: { result: '答案' } }] } })
            await History.add({
                sessionId,
                message: { id: 't1', role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'attempt_completion', output: { type: 'text', value: '答案' } }] },
            })
            await History.save(sessionId)
            History.remove({ sessionId })
            Agent.runtime().clear()

            const agent = fakeAgent({ history: [] })
            let resumeCalled = false
            agent.resume = () => { resumeCalled = true; return Promise.resolve({ reason: 'finished' }) }
            Agent.runtime().set(sessionId, agent)

            const { recovered } = await Chat.recover()
            expect(recovered).toEqual([])
            expect(resumeCalled).toBe(false)
            await Bun.sleep(100)

            const meta = await Bun.file(join(Path.root(), 'sessions', sessionId, 'meta.json')).json()
            expect(meta.running).toBeUndefined()
        })
    })

    test('没有运行标记的会话不参与恢复', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            await History.add({ sessionId, message: { id: 'a1', role: 'assistant', content: text('做到了一半但没在跑') } })
            await History.save(sessionId)
            History.remove({ sessionId })
            Agent.runtime().clear()

            const agent = fakeAgent({
                history: [{ id: 'a1', role: 'assistant', content: text('做到了一半但没在跑') }],
                resumePlan: () => ({ reason: 'finished' }),
            })
            Agent.runtime().set(sessionId, agent)

            const { recovered } = await Chat.recover()
            expect(recovered).toEqual([])
        })
    })

    test('恢复已启动但任务随后失败：保留历史并清掉标记', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            await History.add({ sessionId, message: { id: 'a1', role: 'assistant', content: text('做到一半') } })
            History.setRunning(sessionId, true)
            await History.save(sessionId)
            History.remove({ sessionId })
            Agent.runtime().clear()

            Agent.runtime().set(sessionId, fakeAgent({
                history: [{ id: 'a1', role: 'assistant', content: text('做到一半') }],
                resumePlan: async () => {
                    throw new Error('续跑失败')
                },
            }))

            const { recovered } = await Chat.recover()
            expect(recovered).toEqual([sessionId])   // 续跑已经启动；任务随后自己失败是另一件事。
            await waitForRunning(sessionId, false)
            await Bun.sleep(50)

            const meta = await Bun.file(join(Path.root(), 'sessions', sessionId, 'meta.json')).json()
            expect(meta.running).toBeUndefined()
            expect(History.get({ sessionId }).map(message => message.id)).toEqual(['a1'])
        })
    })

    test('恢复续跑的重试有上限，不会无限空转', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            await History.add({ sessionId, message: { id: 'a1', role: 'assistant', content: text('做到一半') } })

            // 恢复路径上的配置要带封顶的重试策略；用户自己发消息的路径不带。
            const session = await History.load(sessionId)
            const settings = await Agent.readSettings(sessionId)
            const recovery = await Agent.resolve({ session, settings, recovery: true })
            const normal = await Agent.resolve({ session, settings })

            expect(recovery.retryMaxElapsed).toBeGreaterThan(0)
            expect(typeof recovery.retry).toBe('function')
            expect(normal.retryMaxElapsed).toBeUndefined()
            expect(normal.retry).toBeUndefined()

            // 过滤函数第 3 次开始拒绝重试；core 据此结束循环。
            const allow = [recovery.retry(), recovery.retry(), recovery.retry()]
            const results = [allow[0](new Error('x')), allow[0](new Error('x')), allow[0](new Error('x'))]
            expect(results).toEqual([true, true, false])
        })
    })

    test('供应商配置丢了时恢复失败但不拖垮启动，标记被清掉', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            await History.add({ sessionId, message: { id: 'a1', role: 'assistant', content: text('做到一半') } })
            await History.save(sessionId)
            await History.saveMeta(sessionId)

            // 模拟重启后配置里的供应商没了：Agent.get 装配会抛错。
            await Settings.set({ providers: [{ name: 'other', models: [{ id: 'model', name: 'model' }], baseURL: 'http://127.0.0.1:9/v1' }] })
            store.sessions[sessionId].model = { provider: 'local', model: 'model' }
            Agent.runtime().clear()

            const { recovered } = await Chat.recover()
            expect(recovered).toEqual([])
            await Bun.sleep(100)

            const meta = await Bun.file(join(Path.root(), 'sessions', sessionId, 'meta.json')).json()
            expect(meta.running).toBeUndefined()
        })
    })
})
