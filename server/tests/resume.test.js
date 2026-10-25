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

            expect(await Session.stop({ sessionId })).toEqual({ ok: true })

            const history = History.get({ sessionId })
            expect(history.map(message => message.id)).toEqual(['u1', 'a1'])
            expect(history.some(message => message.internal)).toBe(false)
            expect(history.at(-1).content).toEqual(text('做到一半'))
        })
    })

    test('继续时不把内部提示保存成用户消息', async () => {
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
                    agent.history.push({ id: `hidden-${calls.length}`, role: 'user', content: text(options.input) })
                    options.callbacks.onStart()
                    return Promise.resolve().then(() => {
                        agent.history.push({ id: 'a2', role: 'assistant', content: text('继续完成') })
                        return { reason: 'finished' }
                    })
                },
            }
            Store.agents.set(sessionId, agent)

            expect(await Session.resume({ sessionId })).toEqual({ ok: true })
            // 等任务末尾的历史同步跑完。
            for (let attempt = 0; attempt < 50 && History.get({ sessionId }).length < 2; attempt += 1) await Bun.sleep(10)

            expect(calls).toHaveLength(1)
            expect(calls[0].input).toContain('继续上次')
            const history = History.get({ sessionId })
            expect(history.map(message => message.id)).toEqual(['a1', 'a2'])
            expect(history.some(message => message.id.startsWith('hidden'))).toBe(false)
            expect(history.at(-1).content).toEqual(text('继续完成'))
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
            for (let attempt = 0; attempt < 50 && History.get({ sessionId }).length < 3; attempt += 1) await Bun.sleep(10)

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
})
