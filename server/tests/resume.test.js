/*
 * 继续助手：中断时保住已经产生的进度，继续提示不能出现在用户消息里。
 * 这里用假 Agent 检查历史读写，不真的请求模型。
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import AgentCore from '@kernel4632/agent-core'

import Chat from '../commands/chat.js'
import Path from '../utils/path.js'
import Settings from '../commands/settings.js'
import History from '../features/history.js'
import Session from '../commands/session.js'
import Title from '../features/title.js'
import Agent from '../features/agent.js'
import store from '../store.js'
import SSE from '../utils/sse.js'
import { app } from '../server.js'

const homes = []
const withHome = async callback => {
    const root = join(tmpdir(), `agent-resume-${crypto.randomUUID()}`)
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
        // 先把还活着的 Agent 停掉：收尾（保存历史、清运行标记）必须在临时目录里写完，
        // 否则 AGENT_HOME 恢复之后它们会落到真实的 ~/.agent，留下“继续测试”这类垃圾会话。
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

const text = value => [{ type: 'text', text: value }]

// 等到历史文件真的写进这么多条消息，避免测试清理目录时后台保存还在写。
const waitForHistory = async (sessionId, count) => {
    const path = join(process.env.AGENT_HOME, 'sessions', sessionId, 'history.jsonl')
    for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
            const file = Bun.file(path)
            if (await file.exists()) {
                const saved = await file.text()
                if (saved.split('\n').filter(Boolean).length >= count) return
            }
        } catch {
            // 刚好在写盘时可能读到半份内容，下一轮再读。
        }
        await Bun.sleep(10)
    }
}

const readEventsUntil = async (stream, type) => {
    const reader = stream.body.getReader()
    const decoder = new TextDecoder()
    const events = []
    let buffer = ''
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const chunk = await Promise.race([reader.read(), Bun.sleep(1000).then(() => null)])
        if (!chunk || chunk.done) break
        buffer += decoder.decode(chunk.value, { stream: true }).replaceAll('\r', '')
        let boundary
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
            const packet = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            const data = packet.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
            if (!data) continue
            events.push(JSON.parse(data))
            if (events.at(-1).type === type) {
                await reader.cancel().catch(() => {})
                return events
            }
        }
    }
    await reader.cancel().catch(() => {})
    throw new Error(`SSE did not receive ${type}`)
}

const setup = async () => {
    await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }] })
    const { sessionId } = await Session.create({ title: '继续测试' })
    await History.load(sessionId)
    return sessionId
}

describe('继续被中断的助手', () => {
    test('缺 history/settings 的会话仍能打开和删除', async () => {
        await withHome(async root => {
            const sessionId = await setup()
            await rm(join(root, 'sessions', sessionId, 'history.jsonl'), { force: true })
            await rm(join(root, 'sessions', sessionId, 'history.json'), { force: true })
            await rm(join(root, 'sessions', sessionId, 'settings.json'), { force: true })
            History.remove({ sessionId })
            Agent.runtime().clear()

            const session = await Session.read({ sessionId })
            expect(session.history).toEqual([])
            expect(session.settings).toEqual({ reasoning: 'auto' })

            const removed = await Session.remove({ sessionId })
            expect(removed.ok).toBe(true)
            expect(await Bun.file(join(root, 'sessions', sessionId, 'meta.json')).exists()).toBe(false)
        })
    })

    test('供应商被删掉的会话仍能打开', async () => {
        await withHome(async root => {
            const sessionId = await setup()
            const metaPath = join(root, 'sessions', sessionId, 'meta.json')
            const meta = JSON.parse(await readFile(metaPath, 'utf8'))
            meta.model.provider = 'missing-provider'
            await writeFile(metaPath, JSON.stringify(meta))
            History.remove({ sessionId })
            Agent.runtime().clear()

            const session = await Session.read({ sessionId })
            expect(session.history).toEqual([])
            expect(session.provider).toBe('missing-provider')
        })
    })

    test('手动压缩返回文本并把 compact-finish 用量写入 compact 历史', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            const agent = {
                history: [{ id: 'u1', role: 'user', content: text('已有记录') }],
                config: { baseURL: 'http://fixture/v1', model: 'fixture' },
                running: null,
                async compact({ onCompact }) {
                    await onCompact({ type: 'compact-start', messages: [] })
                    await onCompact({ type: 'compact-finish', content: '手动总结', usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } })
                    agent.history.push(AgentCore.history.compact({ id: 'c1', content: '手动总结' }))
                    return '手动总结'
                },
            }
            Agent.runtime().set(sessionId, agent)
            const result = await Session.compact({ sessionId })
            expect(result.content).toBe('手动总结')
            expect(result.history.find(message => message.id === 'c1').usage).toMatchObject({ input: 4, output: 2, total: 6 })
            expect(result.history.find(message => message.id === 'c1').compact).toBe(true)
        })
    })

    test('compact SSE 原样转发并把用量写到对应的历史消息', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            const agent = {
                history: [],
                running: null,
                stop: async () => ({ ok: false }),
                send(options) {
                    return (async () => {
                        agent.history.push({ id: 'u1', role: 'user', content: text(options.input) })
                        await options.callbacks.onStart()
                        await options.callbacks.onCompact({ type: 'compact-start', messages: [] })
                        await options.callbacks.onCompact({ type: 'text-delta', text: '内部摘要增量', request: 'compact' })
                        await options.callbacks.onCompact({
                            type: 'compact-finish', content: '内部摘要',
                            usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
                        })
                        agent.history.push(AgentCore.history.compact({ id: 'c1', content: '内部摘要' }))
                        await options.callbacks.onLLMStart({ messages: [], tools: {} })
                        await options.callbacks.onLLMFinish({ text: '正常回答', usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } })
                        agent.history.push({ id: 'a1', role: 'assistant', content: text('正常回答') })
                        await options.callbacks.onStep({})
                        return { reason: 'finished', text: '正常回答', usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 } }
                    })()
                },
            }
            Agent.runtime().set(sessionId, agent)
            const stream = await SSE.connect({ id: sessionId, request: new Request('http://localhost/sse') })
            const received = readEventsUntil(stream, 'agent-finish')
            expect(await Chat.send({ sessionId, input: '开始任务' })).toEqual({ ok: true })
            const events = await received

            expect(events.find(event => event.type === 'text-delta' && event.request === 'compact')).toMatchObject({ text: '内部摘要增量' })
            const history = History.get({ sessionId })
            expect(history.map(message => message.id)).toEqual(['u1', 'c1', 'a1'])
            expect(history.find(message => message.id === 'c1').usage).toMatchObject({ input: 2, output: 1, total: 3 })
            expect(history.find(message => message.id === 'a1').usage).toMatchObject({ input: 5, output: 2, total: 7 })
            await SSE.close({ id: sessionId })
        })
    })

    test('core 拒绝工具结果通过服务端适配发成 tool-result SSE', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            const agent = {
                history: [],
                running: null,
                stop: async () => ({ ok: false }),
                send(options) {
                    return (async () => {
                        agent.history.push({ id: 'u1', role: 'user', content: text(options.input) })
                        await options.callbacks.onStart()
                        const result = {
                            toolCallId: 'call-denied', toolName: 'read_file', input: { path: 'a.txt' },
                            output: { type: 'execution-denied', reason: '用户拒绝' },
                        }
                        await options.callbacks.onToolResult(result)
                        agent.history.push({
                            id: 'a1', role: 'assistant',
                            content: [{ type: 'tool-call', toolCallId: result.toolCallId, toolName: result.toolName, input: result.input }],
                        })
                        agent.history.push({
                            id: 't1', role: 'tool',
                            content: [{ type: 'tool-result', ...result }],
                        })
                        await options.callbacks.onStep({})
                        return { reason: 'no-tool', text: '', usage: {} }
                    })()
                },
            }
            Agent.runtime().set(sessionId, agent)
            const stream = await SSE.connect({ id: sessionId, request: new Request('http://localhost/sse') })
            const received = readEventsUntil(stream, 'agent-finish')
            expect(await Chat.send({ sessionId, input: '尝试读取' })).toEqual({ ok: true })
            const events = await received
            expect(events.find(event => event.type === 'tool-result')).toMatchObject({
                toolCallId: 'call-denied', toolName: 'read_file',
                output: { type: 'execution-denied', reason: '用户拒绝' },
            })
            await SSE.close({ id: sessionId })
        })
    })

    test('停止时把已经产生的进度写进历史，并丢掉内部提示', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            await History.add({ sessionId, message: { id: 'u1', role: 'user', content: text('开始') } })
            await History.save(sessionId)

            const agent = {
                history: [
                    { id: 'u1', role: 'user', content: text('开始') },
                    { id: 'a1', role: 'assistant', content: text('做到一半') },
                    { id: 'hidden', role: 'user', internal: true, content: text('继续上次任务') },
                ],
                running: { task: Promise.resolve() },
                stop: async () => ({ ok: true }),
            }
            Agent.runtime().set(sessionId, agent)

            await expect(Chat.stop({ sessionId, partial: 'bad' })).rejects.toThrow('partial must be an object')
            expect(await Chat.stop({ sessionId })).toEqual({ ok: true })

            const history = History.get({ sessionId })
            expect(history.map(message => message.id)).toEqual(['u1', 'a1'])
            expect(history.some(message => message.internal)).toBe(false)
            expect(history.at(-1).content).toEqual(text('做到一半'))
        })
    })

    test('原生 resume 不接收 input，也不在历史里新增用户消息', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            await History.add({ sessionId, message: { id: 'a1', role: 'assistant', content: text('做到一半') } })
            await History.save(sessionId)

            const calls = []
            const agent = {
                history: [{ id: 'a1', role: 'assistant', content: text('做到一半') }],
                running: null,
                stop: async () => ({ ok: true }),
                resume(options) {
                    calls.push(options)
                    return Promise.resolve().then(() => options.callbacks.onStart()).then(() => {
                        calls[0].historyAtRequest = agent.history.map(message => message.id)
                        agent.history.push({ id: 'a2', role: 'assistant', content: text('继续完成') })
                        return { reason: 'finished' }
                    })
                },
            }
            Agent.runtime().set(sessionId, agent)
            const stream = await SSE.connect({ id: sessionId, request: new Request('http://localhost/sse') })

            expect(await Chat.resume({ sessionId })).toEqual({ ok: true })
            const reader = stream.body.getReader()
            const decoder = new TextDecoder()
            let events = ''
            while (!events.includes('agent-finish')) {
                const chunk = await Promise.race([reader.read(), Bun.sleep(1000).then(() => null)])
                if (!chunk || chunk.done) break
                events += decoder.decode(chunk.value, { stream: true })
            }
            await waitForHistory(sessionId, 2)
            await Bun.sleep(50)

            expect(events).toContain('agent-resume')
            expect(events).toContain('agent-finish')
            expect(calls).toHaveLength(1)
            expect(calls[0]).not.toHaveProperty('input')
            expect(calls[0].historyAtRequest).toEqual(['a1'])
            const history = History.get({ sessionId })
            expect(history.map(message => message.id)).toEqual(['a1', 'a2'])
            expect(history.at(-1).content).toEqual(text('继续完成'))
            await SSE.close({ id: sessionId })
        })
    })

    test('真实 resume 时发给模型的末尾仍是原来的助手回复', async () => {
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
                await Settings.set({ providers: [{ name: 'fake', models: [{ id: 'm', name: 'm' }], baseURL: `http://127.0.0.1:${server.port}/v1`, stream: false }] })
                const { sessionId } = await Session.create({ title: '无缝继续' })
                await History.add({ sessionId, message: { id: 'u1', role: 'user', content: text('开始') } })
                await History.add({ sessionId, message: { id: 'a1', role: 'assistant', content: text('做到一半') } })
                await History.save(sessionId)

                expect(await Chat.resume({ sessionId })).toEqual({ ok: true })
                await waitForHistory(sessionId, 3)
                await Bun.sleep(50)

                expect(seen.length).toBeGreaterThan(0)
                const messages = seen[0].messages
                expect(messages.at(-1).role).toBe('assistant')
                expect(messages.at(-1).content).toContain('做到一半')
                // 系统提示词里有压缩规范，不能拿它判断是否多塞了对话消息。
                expect(JSON.stringify(messages.filter(message => message.role !== 'system'))).not.toContain('继续')

                const saved = History.get({ sessionId }).find(message => message.usage)
                expect(saved?.usage).toMatchObject({ input: 1, output: 1, total: 2, cacheRead: 1 })
                expect(saved.usage.durationMs).toBeGreaterThanOrEqual(0)

                for (let attempt = 0; attempt < 100 && Agent.runtime().get(sessionId)?.running; attempt += 1) await Bun.sleep(10)
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
            await History.save(sessionId)

            let stepSaved
            const agent = {
                history: [{ id: 'a0', role: 'assistant', content: text('旧进度') }],
                running: null,
                stop: async () => ({ ok: true }),
                send(options) {
                    agent.history.push({ id: 'u1', role: 'user', content: text('新任务') })
                    stepSaved = options.callbacks.onStart().then(async () => {
                        agent.history.push({ id: 'a1', role: 'assistant', content: text('已完成一步') })
                        await options.callbacks.onStep()
                    })
                    return new Promise(() => {})
                },
            }
            Agent.runtime().set(sessionId, agent)

            expect(await Chat.send({ sessionId, input: '新任务' })).toEqual({ ok: true })
            await stepSaved
            await waitForHistory(sessionId, 3)

            const history = History.get({ sessionId })
            expect(history.map(message => message.id)).toEqual(['a0', 'u1', 'a1'])
            expect(history.at(-1).content).toEqual(text('已完成一步'))
        })
    })

    test('工具开始和结束时间落到会话计时账本', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            const call = { toolCallId: 'call-timing', toolName: 'read_file', input: { path: 'a.txt' } }
            const agent = {
                history: [],
                running: null,
                stop: async () => ({ ok: true }),
                send(options) {
                    return (async () => {
                        await options.callbacks.onStart()
                        agent.history.push({ id: 'u1', role: 'user', content: text('读文件') })
                        await options.callbacks.onToolCall(call)
                        await Bun.sleep(30)
                        const result = { ...call, output: { type: 'text', value: 'ok' } }
                        await options.callbacks.onToolResult(result)
                        agent.history.push({ id: 'a1', role: 'assistant', content: [{ type: 'tool-call', ...call }] })
                        agent.history.push({ id: 't1', role: 'tool', content: [{ type: 'tool-result', ...result }] })
                        await options.callbacks.onStep()
                        return { reason: 'finished' }
                    })()
                },
            }
            Agent.runtime().set(sessionId, agent)

            expect(await Chat.send({ sessionId, input: '读文件' })).toEqual({ ok: true })
            await waitForHistory(sessionId, 3)
            const read = await Session.read({ sessionId })
            const timing = read.toolTimings['call-timing']
            expect(timing.startedAt).toBeGreaterThan(0)
            expect(timing.finishedAt).toBeGreaterThanOrEqual(timing.startedAt)
            expect(timing.durationMs).toBeGreaterThanOrEqual(20)

            const onDisk = JSON.parse(await readFile(join(process.env.AGENT_HOME, 'sessions', sessionId, 'tool-timings.json'), 'utf8'))
            expect(onDisk['call-timing']).toMatchObject(timing)
        })
    })

    test('中断的工具结果带上已执行时间', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            const call = { toolCallId: 'call-interrupted', toolName: 'read_file', input: { path: 'a.txt' } }
            const agent = {
                history: [],
                running: null,
                stop: async () => ({ ok: true }),
                send(options) {
                    return (async () => {
                        await options.callbacks.onStart()
                        agent.history.push({ id: 'u1', role: 'user', content: text('读文件') })
                        await options.callbacks.onToolCall(call)
                        await Bun.sleep(30)
                        const result = { ...call, output: { type: 'error-text', value: '工具执行已中断' } }
                        await options.callbacks.onToolResult(result)
                        agent.history.push({ id: 'a1', role: 'assistant', content: [{ type: 'tool-call', ...call }] })
                        agent.history.push({ id: 't1', role: 'tool', content: [{ type: 'tool-result', ...result }] })
                        await options.callbacks.onStep()
                        return { reason: 'finished' }
                    })()
                },
            }
            Agent.runtime().set(sessionId, agent)

            expect(await Chat.send({ sessionId, input: '读文件' })).toEqual({ ok: true })
            await waitForHistory(sessionId, 3)
            const toolResult = History.get({ sessionId })
                .find(message => message.role === 'tool')?.content
                ?.find(part => part.type === 'tool-result')
            expect(toolResult.output.value).toMatch(/^工具执行已中断（已执行 \d+s）$/)
        })
    })

    test('任务在跑或最后一条不是助手回复时拒绝继续', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            Agent.runtime().set(sessionId, {
                history: [{ id: 'u1', role: 'user', content: text('开始') }],
                running: null,
                stop: async () => ({ ok: true }),
            })
            await expect(Chat.resume({ sessionId })).rejects.toMatchObject({ status: 409 })

            const running = Agent.runtime().get(sessionId)
            running.history = [{ id: 'a1', role: 'assistant', content: text('做到一半') }]
            running.running = { task: Promise.resolve() }
            await expect(Chat.resume({ sessionId })).rejects.toMatchObject({ status: 409 })
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
                resume(options) {
                    return options.callbacks.onStart().then(() => ({ reason: 'finished' }))
                },
            }
            Agent.runtime().set(sessionId, agent)

            const stream = await SSE.connect({ id: sessionId, request: new Request('http://localhost/sse') })
            const finished = readEventsUntil(stream, 'agent-finish')
            expect(await Chat.resume({ sessionId })).toEqual({ ok: true })
            await finished
            expect(History.get({ sessionId }).map(message => message.id)).toEqual(['a1', 't1'])
            await SSE.close({ id: sessionId })
        })
    })

    test('原生继续失败时保留原历史并发出错误终态', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            await History.add({ sessionId, message: { id: 'a1', role: 'assistant', content: text('做到一半') } })
            await History.save(sessionId)
            const agent = {
                history: [{ id: 'a1', role: 'assistant', content: text('做到一半') }],
                running: null,
                stop: async () => ({ ok: true }),
                resume(options) {
                    expect(options).not.toHaveProperty('input')
                    return options.callbacks.onStart().then(() => { throw new Error('继续请求失败') })
                },
            }
            Agent.runtime().set(sessionId, agent)
            const stream = await SSE.connect({ id: sessionId, request: new Request('http://localhost/sse') })

            expect(await Chat.resume({ sessionId })).toEqual({ ok: true })
            const reader = stream.body.getReader()
            const decoder = new TextDecoder()
            let events = ''
            while (!events.includes('agent-finish')) {
                const chunk = await Promise.race([reader.read(), Bun.sleep(1000).then(() => null)])
                if (!chunk || chunk.done) break
                events += decoder.decode(chunk.value, { stream: true })
            }

            expect(events).toContain('agent-resume')
            expect(events).toContain('继续请求失败')
            expect(events.match(/agent-finish/g)).toHaveLength(1)
            expect(agent.history.map(message => message.id)).toEqual(['a1'])
            expect(History.get({ sessionId }).map(message => message.id)).toEqual(['a1'])
            await SSE.close({ id: sessionId })
        })
    })

    test('read 不返回磁盘里的内部提示', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            await History.add({ sessionId, message: { id: 'u1', role: 'user', content: text('真实问题') } })
            await History.add({ sessionId, message: { id: 'i1', role: 'user', internal: true, content: text('继续上次任务') } })
            await History.save(sessionId)

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
            Agent.runtime().set(sessionId, agent)
            const stream = await SSE.connect({ id: sessionId, request: new Request('http://localhost/sse') })
            expect(await Chat.send({ sessionId, input: '会超时' })).toEqual({ ok: true })

            const reader = stream.body.getReader()
            const decoder = new TextDecoder()
            let events = ''
            while (!events.includes('agent-finish')) {
                const chunk = await Promise.race([reader.read(), Bun.sleep(1000).then(() => null)])
                if (!chunk || chunk.done) break
                events += decoder.decode(chunk.value, { stream: true })
            }
            expect(events).toContain('agent-finish')
            expect(events).toContain('请求超时')
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
                    agent.running = { task: Promise.resolve() }
                    agent.history.push({ id: 'u1', role: 'user', content: text(options.input) })
                    void options.callbacks.onStart()
                    return new Promise(() => {})
                },
                stop: () => new Promise(resolve => { finishStop = () => resolve({ ok: true }) }),
            }
            Agent.runtime().set(sessionId, agent)
            expect(await Chat.send({ sessionId, input: '第一轮' })).toEqual({ ok: true })
            await Bun.sleep(20)

            const stopping = Chat.stop({ sessionId })
            await Bun.sleep(10)
            await expect(Chat.send({ sessionId, input: '第二轮' })).rejects.toMatchObject({ status: 409 })
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
                    release?.()
                    return { ok: true }
                },
                send(options) {
                    agent.running = { task: Promise.resolve() }
                    agent.history.push({ id: 'u1', role: 'user', content: text(options.input) })
                    void options.callbacks.onStart()
                    return new Promise(resolve => { release = () => resolve({ reason: 'finished' }) })
                },
            }
            Agent.runtime().set(sessionId, agent)
            const stream = await SSE.connect({ id: sessionId, request: new Request('http://localhost/sse') })
            expect(await Chat.send({ sessionId, input: '跑一半停' })).toEqual({ ok: true })
            await Bun.sleep(20)
            expect(await Chat.stop({ sessionId, partial: { content: '界面上的半段' } })).toEqual({ ok: true })

            const reader = stream.body.getReader()
            const decoder = new TextDecoder()
            let events = ''
            while (!events.includes('agent-finish')) {
                const chunk = await Promise.race([reader.read(), Bun.sleep(1000).then(() => null)])
                if (!chunk || chunk.done) break
                events += decoder.decode(chunk.value, { stream: true })
            }
            await Bun.sleep(50)
            expect(events.match(/agent-finish/g)).toHaveLength(1)
            expect(events).not.toContain('error')
            const history = History.get({ sessionId })
            expect(history.at(-1).content).toEqual(text('界面上的半段'))
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
            Agent.runtime().set(sessionId, {
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
            Agent.runtime().set(sessionId, {
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
                resume(options) {
                    options.callbacks.onStart()
                    return Promise.resolve().then(() => {
                        agent.history.push({ id: 'a2', role: 'assistant', content: text('继续完成') })
                        return { reason: 'finished' }
                    })
                },
            }
            Agent.runtime().set(sessionId, agent)

            const stream = await SSE.connect({ id: sessionId, request: new Request('http://localhost/sse') })
            const response = await resumeRequest(sessionId)
            expect(response.status).toBe(200)
            expect(await response.json()).toEqual({ ok: true })

            const reader = stream.body.getReader()
            const decoder = new TextDecoder()
            let events = ''
            while (!events.includes('agent-finish')) {
                const chunk = await Promise.race([reader.read(), Bun.sleep(1000).then(() => null)])
                if (!chunk || chunk.done) break
                events += decoder.decode(chunk.value, { stream: true })
            }
            expect(events).toContain('agent-resume')
            expect(events).toContain('agent-finish')

            await waitForHistory(sessionId, 2)
            expect(History.get({ sessionId }).map(message => message.id)).toEqual(['a1', 'a2'])
            await SSE.close({ id: sessionId })
        })
    })

    test('用户可以按后续对话重新生成标题，模型失败时用第一句话兜底', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }] })
            const { sessionId } = await Session.create({ title: '旧标题' })
            await History.add({ sessionId, message: { id: 'u1', role: 'user', content: text('帮我修一下登录') } })
            await History.add({ sessionId, message: { id: 'a1', role: 'assistant', content: text('好的') } })
            await History.save(sessionId)

            const original = Title.generate
            Title.generate = async () => '修复登录问题'
            try {
                expect(await Session.generateTitle({ sessionId })).toEqual({ title: '修复登录问题' })
            } finally {
                Title.generate = original
            }

            Title.generate = async () => null
            try {
                expect(await Session.generateTitle({ sessionId })).toEqual({ title: '帮我修一下登录' })
            } finally {
                Title.generate = original
            }

            await expect(Session.generateTitle({ sessionId: 'missing' })).rejects.toMatchObject({ status: 404 })
        })
    })

    test('自动起标题成功时不会因为默认标题常量缺失而中断', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }] })
            const { sessionId } = await Session.create({ title: '新对话' })
            await History.load(sessionId)

            const original = Title.generate
            Title.generate = async () => '修复登录'
            try {
                const agent = {
                    history: [],
                    running: null,
                    stop: async () => ({ ok: true }),
                    async send(options) {
                        await options.callbacks.onStart()
                        agent.history.push({ id: 'u1', role: 'user', content: text('你好') })
                        agent.history.push({ id: 'a1', role: 'assistant', content: text('完成') })
                        await options.callbacks.onStep()
                        return { reason: 'completed', text: '完成' }
                    },
                }
                Agent.runtime().set(sessionId, agent)
                await Chat.send({ sessionId, input: '你好' })

                for (let attempt = 0; attempt < 50; attempt += 1) {
                    if ((await Session.read({ sessionId })).title === '修复登录') break
                    await Bun.sleep(10)
                }
                expect((await Session.read({ sessionId })).title).toBe('修复登录')
                await Bun.sleep(50)
            } finally {
                Title.generate = original
            }
        })
    })

    test('一次请求只开一行，重试沿用开始时间并记录首字', async () => {        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }] })
            const { sessionId } = await Session.create({ title: '请求计时' })
            await History.load(sessionId)

            const agent = {
                history: [],
                running: null,
                config: { providerName: 'local', model: 'model' },
                stop: async () => ({ ok: true }),
                async send(options) {
                    const callbacks = options.callbacks
                    await callbacks.onStart()
                    await callbacks.onCompact({ type: 'compact-start', messages: 5 })
                    await callbacks.onCompact({ type: 'compact-finish', content: '摘要', usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } })
                    await callbacks.onLLMStart({ messages: [], tools: {} })
                    await callbacks.onLLMStart({ messages: [], tools: {} })   // 重试：不能再开一行
                    await callbacks.onLLMEvent({ type: 'text-delta', text: '你' })
                    await callbacks.onLLMFinish({ text: '你好', usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 } })
                    agent.history.push({ id: 'u1', role: 'user', content: text('你好') })
                    agent.history.push({ id: 'a1', role: 'assistant', content: text('你好') })
                    await callbacks.onStep()
                    return { reason: 'completed', text: '你好' }
                },
            }
            Agent.runtime().set(sessionId, agent)
            const stream = await SSE.connect({ id: sessionId })
            await Chat.send({ sessionId, input: '你好' })
            const events = await readEventsUntil(stream, 'agent-finish')

            const starts = events.filter(event => event.type === 'llm-start')
            expect(starts).toHaveLength(1)
            expect(starts[0].startedAt).toBeGreaterThan(0)
            expect(starts[0].provider).toBe('local')
            expect(starts[0].model).toBe('model')
            expect(events.filter(event => event.type === 'llm-first-token')).toHaveLength(1)
            const compactStart = events.find(event => event.type === 'compact-start')
            expect(compactStart.startedAt).toBeGreaterThan(0)
            const compactFinish = events.find(event => event.type === 'compact-finish')
            expect(compactFinish.usage).toMatchObject({ input: 5, output: 2, total: 7 })
            expect(compactFinish.durationMs).toBeGreaterThanOrEqual(0)
            const finish = events.find(event => event.type === 'llm-finish')
            expect(finish.usage.provider).toBe('local')
            expect(finish.usage.model).toBe('model')
            expect(finish.usage.firstTokenMs).toBeGreaterThanOrEqual(0)
            expect(finish.usage.durationMs).toBeGreaterThanOrEqual(0)
            await SSE.close({ id: sessionId })
        })
    })

    test('流内部的 error 帧不转发，错误终态只由 agent-finish 表达', async () => {
        await withHome(async () => {
            const sessionId = await setup()
            const agent = {
                history: [],
                running: null,
                config: { providerName: 'local', model: 'model' },
                stop: async () => ({ ok: true }),
                async send(options) {
                    const callbacks = options.callbacks
                    await callbacks.onStart()
                    await callbacks.onLLMEvent({ type: 'text-delta', text: '回完' })
                    await callbacks.onLLMFinish({ text: '回完', usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 } })
                    agent.history.push({ id: 'u1', role: 'user', content: text('问') })
                    agent.history.push({ id: 'a1', role: 'assistant', content: text('回完') })
                    await callbacks.onStep()
                    // 供应商收尾时的噪音错误：不影响结果，不该进前端。
                    await callbacks.onLLMEvent({ type: 'error', errorText: '收尾噪音' })
                    return { reason: 'finished', text: '回完' }
                },
            }
            Agent.runtime().set(sessionId, agent)
            const stream = await SSE.connect({ id: sessionId })
            await Chat.send({ sessionId, input: '问' })
            const events = await readEventsUntil(stream, 'agent-finish')

            expect(events.some(event => event.type === 'error')).toBe(false)   // 噪音错误不转发
            expect(events.filter(event => event.type === 'agent-finish')).toHaveLength(1)
            expect(events.find(event => event.type === 'agent-finish').error).toBeUndefined()
            expect(events.some(event => event.type === 'text-delta')).toBe(true)
            await SSE.close({ id: sessionId })
        })
    })
})
