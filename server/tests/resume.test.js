/*
 * 继续助手：中断时保住已经产生的进度，继续提示不能出现在用户消息里。
 * 这里用假 Agent 检查历史读写，不真的请求模型。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import Config from '../commands/config.js'
import History from '../features/history.js'
import Session from '../commands/session.js'
import Store from '../store.js'
import SSE from '../utils/sse.js'
import { app } from '../server.js'

const homes = []
const withHome = async callback => {
    const root = join(tmpdir(), `agent-resume-${crypto.randomUUID()}`)
    homes.push(root)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
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
    }
}

afterEach(async () => {
    await Promise.all(homes.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const text = value => [{ type: 'text', text: value }]

// 等到历史文件真的写进这么多条消息，避免测试清理目录时后台保存还在写。
const waitForHistory = async (sessionId, count) => {
    const path = join(process.env.AGENT_HOME, 'sessions', sessionId, 'history.json')
    for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
            const file = Bun.file(path)
            if (await file.exists()) {
                const saved = await file.json()
                if ((saved.messages?.length || 0) >= count) return
            }
        } catch {
            // 刚好在写盘时可能读到半份内容，下一轮再读。
        }
        await Bun.sleep(10)
    }
}
const setup = async () => {
    await Config.set({ providers: [{ name: 'local', models: ['model'] }] })
    const { sessionId } = await Session.create({ title: '继续测试' })
    await History.load({ sessionId })
    return sessionId
}

describe('继续被中断的助手', () => {
    test('停止时把已经产生的进度写进历史，并丢掉内部提示', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            await History.add({ sessionId, message: { id: 'u1', role: 'user', content: text('开始') } })
            await History.save({ sessionId })

            const agent = {
                history: [
                    { id: 'u1', role: 'user', content: text('开始') },
                    { id: 'a1', role: 'assistant', content: text('做到一半') },
                    { id: 'hidden', role: 'user', internal: true, content: text('继续上次任务') },
                ],
                running: { task: Promise.resolve() },
                stop: async () => ({ ok: true }),
            }
            Store.agents.set(sessionId, agent)

            await expect(Session.stop({ sessionId, partial: 'bad' })).rejects.toThrow('partial must be an object')
            expect(await Session.stop({ sessionId })).toEqual({ ok: true })

            const history = History.get({ sessionId })
            expect(history.map(message => message.id)).toEqual(['u1', 'a1'])
            expect(history.some(message => message.internal)).toBe(false)
            expect(history.at(-1).content).toEqual(text('做到一半'))
        })
    })

    test('继续时不在历史里留下用户消息，模型只看到原来的进度', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            await History.add({ sessionId, message: { id: 'a1', role: 'assistant', content: text('做到一半') } })
            await History.save({ sessionId })

            const calls = []
            const agent = {
                history: [{ id: 'a1', role: 'assistant', content: text('做到一半') }],
                running: null,
                stop: async () => ({ ok: true }),
                send(options) {
                    calls.push(options)
                    agent.history.push({ id: 'resume-input', role: 'user', content: text(options.input) })
                    return Promise.resolve().then(() => options.callbacks.onStart()).then(() => {
                        // 第一次模型请求前，历史必须已经恢复成发送前的样子。
                        calls[0].historyAtRequest = agent.history.map(message => message.id)
                        agent.history.push({ id: 'a2', role: 'assistant', content: text('继续完成') })
                        return { reason: 'finished' }
                    })
                },
            }
            Store.agents.set(sessionId, agent)

            expect(await Session.resume({ sessionId })).toEqual({ ok: true })
            // 等任务末尾的历史同步和写盘都跑完。
            await waitForHistory(sessionId, 2)
            await Bun.sleep(50) // 让任务末尾的 agent-finish 也走完，测试目录再清理

            expect(calls).toHaveLength(1)
            expect(calls[0].historyAtRequest).toEqual(['a1'])
            const history = History.get({ sessionId })
            expect(history.map(message => message.id)).toEqual(['a1', 'a2'])
            expect(history.at(-1).content).toEqual(text('继续完成'))
        })
    })

    test('真实执行时发给模型的末尾仍是原来的助手回复', async () => {
        await withHome(async () => {
            const seen = []
            const server = Bun.serve({
                port: 0,
                async fetch(request) {
                    seen.push(await request.json().catch(() => null))
                    return Response.json({
                        id: 'fake', object: 'chat.completion', created: Date.now(), model: 'fake',
                        choices: [{ index: 0, message: { role: 'assistant', content: '补充完成' }, finish_reason: 'stop' }],
                        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, prompt_tokens_details: { cached_tokens: 1 } },
                    })
                },
            })
            try {
                await Config.set({ providers: [{ name: 'fake', models: ['m'], baseURL: `http://127.0.0.1:${server.port}/v1` }] })
                const { sessionId } = await Session.create({ title: '无缝继续' })
                await History.add({ sessionId, message: { id: 'u1', role: 'user', content: text('开始') } })
                await History.add({ sessionId, message: { id: 'a1', role: 'assistant', content: text('做到一半') } })
                await History.save({ sessionId })
                // 用非流式响应，测试只需要看发出去的历史，不关心增量事件。
                await Session.saveSettings({ sessionId, capabilities: { image: true, cache: true, stream: false } })

                expect(await Session.resume({ sessionId })).toEqual({ ok: true })
                await waitForHistory(sessionId, 3)
                await Bun.sleep(50)

                expect(seen.length).toBeGreaterThan(0)
                const messages = seen[0].messages
                // 末尾还是助手回复，没有“继续”这条用户消息，模型会直接接着写。
                expect(messages.at(-1).role).toBe('assistant')
                expect(messages.at(-1).content).toContain('做到一半')
                expect(JSON.stringify(messages)).not.toContain('继续')

                // 用量挂到助手消息上，刷新页面后请求行仍然能显示输入/输出。
                const saved = History.get({ sessionId }).find(message => message.usage)
                expect(saved?.usage).toMatchObject({ input: 1, output: 1, total: 2, cacheRead: 1 })
                expect(saved.usage.durationMs).toBeGreaterThanOrEqual(0)

                // 模型没有调用结束工具时会继续追加提示；等这一轮彻底停下再清理临时目录。
                for (let attempt = 0; attempt < 100 && Store.agents.get(sessionId)?.running; attempt += 1) await Bun.sleep(10)
                await Bun.sleep(100)
            } finally {
                await server.stop(true)
            }
        })
    })

    test('每一步结束后就把进度写进历史', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            await History.add({ sessionId, message: { id: 'a0', role: 'assistant', content: text('旧进度') } })
            await History.save({ sessionId })

            const agent = {
                history: [{ id: 'a0', role: 'assistant', content: text('旧进度') }],
                running: null,
                stop: async () => ({ ok: true }),
                send(options) {
                    agent.history.push({ id: 'u1', role: 'user', content: text('新任务') })
                    options.callbacks.onStart()
                    setTimeout(() => {
                        agent.history.push({ id: 'a1', role: 'assistant', content: text('已完成一步') })
                        options.callbacks.onStep()
                    }, 0)
                    // 模拟下一步开始前进程被关掉，任务永远不返回。
                    return new Promise(() => {})
                },
            }
            Store.agents.set(sessionId, agent)

            expect(await Session.send({ sessionId, input: '新任务' })).toEqual({ ok: true })
            await waitForHistory(sessionId, 3)

            const history = History.get({ sessionId })
            expect(history.map(message => message.id)).toEqual(['a0', 'u1', 'a1'])
            expect(history.at(-1).content).toEqual(text('已完成一步'))
        })
    })

    test('任务在跑或最后一条不是助手回复时拒绝继续', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            Store.agents.set(sessionId, {
                history: [{ id: 'u1', role: 'user', content: text('开始') }],
                running: null,
                stop: async () => ({ ok: true }),
            })
            await expect(Session.resume({ sessionId })).rejects.toMatchObject({ status: 409 })

            const running = Store.agents.get(sessionId)
            running.history = [{ id: 'a1', role: 'assistant', content: text('做到一半') }]
            running.running = { task: Promise.resolve() }
            await expect(Session.resume({ sessionId })).rejects.toMatchObject({ status: 409 })
        })
    })

    test('最后一条是工具结果时仍可继续', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            const agent = {
                history: [
                    { id: 'a1', role: 'assistant', content: text('准备执行工具') },
                    { id: 't1', role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'read_file', output: { type: 'text', value: 'ok' } }] },
                ],
                running: null,
                stop: async () => ({ ok: true }),
                send(options) {
                    agent.history.push({ id: 'resume-input', role: 'user', content: text(options.input) })
                    return options.callbacks.onStart().then(() => ({ reason: 'finished' }))
                },
            }
            Store.agents.set(sessionId, agent)

            expect(await Session.resume({ sessionId })).toEqual({ ok: true })
            await waitForHistory(sessionId, 2) // a1 和工具结果都要落盘
            expect(History.get({ sessionId }).map(message => message.id)).toEqual(['a1', 't1'])
        })
    })

    test('继续占位被改写时不删除也不保存', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            await History.add({ sessionId, message: { id: 'a1', role: 'assistant', content: text('做到一半') } })
            await History.save({ sessionId })
            const agent = {
                history: [{ id: 'a1', role: 'assistant', content: text('做到一半') }],
                running: null,
                stop: async () => ({ ok: true }),
                send(options) {
                    // 模拟 append 的继续提示被改写：不能把它当成内部提示藏起来，也不能删掉。
                    agent.history.push({ id: 'real-user', role: 'user', content: text('继续上次未完成的任务，但被加了后缀') })
                    return options.callbacks.onStart()                       // 让 onStart 的校验失败传到任务 Promise
                },
            }
            Store.agents.set(sessionId, agent)

            expect(await Session.resume({ sessionId })).toEqual({ ok: true })
            await Bun.sleep(50) // 等 task.then 走完错误收尾

            expect(agent.history.map(message => message.id)).toEqual(['a1', 'real-user']) // 被改写的消息也不能删除
            expect(History.get({ sessionId }).map(message => message.id)).toEqual(['a1']) // 但失败时不能写进磁盘
        })
    })

    test('read 不返回磁盘里的内部提示', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            await History.add({ sessionId, message: { id: 'u1', role: 'user', content: text('真实问题') } })
            await History.add({ sessionId, message: { id: 'i1', role: 'user', internal: true, content: text('继续上次任务') } })
            await History.save({ sessionId })

            const read = await Session.read({ sessionId })
            expect(read.history.map(message => message.id)).toEqual(['u1'])
            expect(JSON.stringify(read.history)).not.toContain('继续上次任务')
        })
    })

    test('timeout 不是用户停止，仍然要发错误 agent-finish', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            const agent = {
                history: [],
                running: null,
                stop: async () => ({ ok: true }),
                send(options) {
                    agent.history.push({ id: 'u1', role: 'user', content: text(options.input) })
                    return options.callbacks.onStart().then(() => Promise.reject(Object.assign(new Error('请求超时'), { name: 'AbortError', kind: 'timeout' })))
                },
            }
            Store.agents.set(sessionId, agent)
            const stream = await SSE.connect({ id: sessionId, request: new Request('http://localhost/sse') })
            expect(await Session.send({ sessionId, input: '会超时' })).toEqual({ ok: true })

            const reader = stream.body.getReader()
            const decoder = new TextDecoder()
            let events = ''
            while (!events.includes('agent-finish')) {
                const chunk = await Promise.race([reader.read(), Bun.sleep(1000).then(() => null)])
                if (!chunk || chunk.done) break
                events += decoder.decode(chunk.value, { stream: true })
            }
            expect(events).toContain('agent-finish')
            expect(events).toContain('请求超时') // 不能因为 name 叫 AbortError 就被吞掉
            await SSE.close({ id: sessionId })
        })
    })

    test('stop 处理中拒绝启动新 run', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            let finishStop
            const agent = {
                history: [],
                running: null,
                send(options) {
                    agent.running = { task: Promise.resolve() }        // 模拟 Agent 开始运行
                    agent.history.push({ id: 'u1', role: 'user', content: text(options.input) })
                    void options.callbacks.onStart()
                    return new Promise(() => {})                        // 这一轮一直跑着，等 stop
                },
                stop: () => new Promise(resolve => { finishStop = () => resolve({ ok: true }) }),
            }
            Store.agents.set(sessionId, agent)
            expect(await Session.send({ sessionId, input: '第一轮' })).toEqual({ ok: true })
            await Bun.sleep(20)

            const stopping = Session.stop({ sessionId })
            await Bun.sleep(10)
            await expect(Session.send({ sessionId, input: '第二轮' })).rejects.toMatchObject({ status: 409 })
            finishStop()
            expect(await stopping).toEqual({ ok: true })
        })
    })

    test('stop 和任务正常完成同时发生也只发一次 agent-finish', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            let release
            const agent = {
                history: [],
                running: null,
                stop: async () => {
                    release?.()                                        // 模拟 stop 之后任务才正常 resolve
                    return { ok: true }
                },
                send(options) {
                    agent.running = { task: Promise.resolve() }        // 模拟 Agent 开始运行
                    agent.history.push({ id: 'u1', role: 'user', content: text(options.input) })
                    void options.callbacks.onStart()
                    return new Promise(resolve => { release = () => resolve({ reason: 'finished' }) })
                },
            }
            Store.agents.set(sessionId, agent)
            const stream = await SSE.connect({ id: sessionId, request: new Request('http://localhost/sse') })
            expect(await Session.send({ sessionId, input: '跑一半停' })).toEqual({ ok: true })
            await Bun.sleep(20)                                        // 等 onStart 保存和 agent-start
            expect(await Session.stop({ sessionId, partial: { content: '界面上的半段' } })).toEqual({ ok: true })

            const reader = stream.body.getReader()
            const decoder = new TextDecoder()
            let events = ''
            while (!events.includes('agent-finish')) {
                const chunk = await Promise.race([reader.read(), Bun.sleep(1000).then(() => null)])
                if (!chunk || chunk.done) break
                events += decoder.decode(chunk.value, { stream: true })
            }
            await Bun.sleep(50)                                        // 给 task.then 机会再发第二条（不应该有）
            expect(events.match(/agent-finish/g)).toHaveLength(1)
            expect(events).not.toContain('error')                      // 用户主动停止不是程序错误
            const history = History.get({ sessionId })
            expect(history.at(-1).content).toEqual(text('界面上的半段')) // 半段正文已经补进历史
            await SSE.close({ id: sessionId })
        })
    })
})

describe('继续助手的 HTTP 接口', () => {
    const resumeRequest = sessionId => app.handle(new Request(`http://localhost/agent/resume/${sessionId}`, { method: 'POST' }))

    test('会话不存在时返回 404', async () => {
        await withHome(async () => {
            const response = await resumeRequest('missing-session')
            expect(response.status).toBe(404)
            expect(await response.json()).toMatchObject({ error: expect.stringContaining('missing-session') })
        })
    })

    test('最后一条不是助手回复时返回 409', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            Store.agents.set(sessionId, {
                history: [{ id: 'u1', role: 'user', content: text('还没回答') }],
                running: null,
                stop: async () => ({ ok: true }),
            })

            const response = await resumeRequest(sessionId)
            expect(response.status).toBe(409)
            expect(await response.json()).toMatchObject({ error: expect.stringContaining('助手') })
        })
    })

    test('任务已经在跑时返回 409', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            Store.agents.set(sessionId, {
                history: [{ id: 'a1', role: 'assistant', content: text('做到一半') }],
                running: { task: Promise.resolve() },
                stop: async () => ({ ok: true }),
            })

            const response = await resumeRequest(sessionId)
            expect(response.status).toBe(409)
            expect(await response.json()).toMatchObject({ error: expect.stringContaining('running') })
        })
    })

    test('继续成功时返回 ok，并通过 SSE 推 agent-resume', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            const agent = {
                history: [{ id: 'a1', role: 'assistant', content: text('做到一半') }],
                running: null,
                stop: async () => ({ ok: true }),
                send(options) {
                    agent.history.push({ id: 'resume-input', role: 'user', content: text(options.input) })
                    options.callbacks.onStart()
                    return Promise.resolve().then(() => {
                        agent.history.push({ id: 'a2', role: 'assistant', content: text('继续完成') })
                        return { reason: 'finished' }
                    })
                },
            }
            Store.agents.set(sessionId, agent)

            // 先连上 SSE，接口触发后从同一条流里读事件。
            const stream = await SSE.connect({ id: sessionId, request: new Request('http://localhost/sse') })
            const response = await resumeRequest(sessionId)
            expect(response.status).toBe(200)
            expect(await response.json()).toEqual({ ok: true })

            const reader = stream.body.getReader()
            const decoder = new TextDecoder()
            let events = ''
            // 一直读到这一轮结束，确保最终保存和 agent-finish 都已经发生。
            while (!events.includes('agent-finish')) {
                const chunk = await Promise.race([reader.read(), Bun.sleep(1000).then(() => null)])
                if (!chunk || chunk.done) break
                events += decoder.decode(chunk.value, { stream: true })
            }
            expect(events).toContain('agent-resume')
            expect(events).toContain('agent-finish')

            // 等任务末尾落盘，确认内部提示没有被保存成用户消息。
            await waitForHistory(sessionId, 2)
            expect(History.get({ sessionId }).map(message => message.id)).toEqual(['a1', 'a2'])
            await SSE.close({ id: sessionId })
        })
    })
})
