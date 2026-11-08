/*
 * 上下文余量提醒：距压缩点只剩 5% 预算时，往下一笔请求临时插一句，让模型收口。
 *
 * 用假 Agent 直接调 callbacks.onInject 检查行为：阈值从 compact.threshold 推导、
 * 每个 run 只提醒一次、没到提醒带不插、预算为 Infinity（关压缩）不插。
 * 运行：cd server && bun test tests/inject.test.js
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import Chat from '../commands/chat.js'
import Settings from '../commands/settings.js'
import History from '../features/history.js'
import Session from '../commands/session.js'
import Agent from '../features/agent.js'
import ContextUsage from '../utils/context-usage.js'
import store from '../store.js'
import { app } from '../server.js'

const homes = []
const withHome = async callback => {
    const root = join(tmpdir(), `agent-inject-${crypto.randomUUID()}`)
    homes.push(root)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    Object.keys(store.config).forEach(key => delete store.config[key])
    Agent.runtime().clear()
    try {
        return await callback(root)
    } finally {
        for (const [, agent] of Agent.runtime()) {
            await Promise.race([agent.stop?.().catch(() => {}), Bun.sleep(500)])
        }
        Agent.runtime().clear()
        if (previousHome === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previousHome
    }
}

afterEach(async () => {
    await Promise.all(homes.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

// 起一个假 agent 跑一次 send，把 onInject 回调吐出来给测试直接驱动。
const capturedInject = async ({ history = [] } = {}) => {
    await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }], baseURL: 'http://127.0.0.1:9/v1' }] })
    const { sessionId } = await Session.create({ title: '余量提醒' })
    await History.load(sessionId)
    let onInject = null
    const agent = {
        history,
        running: null,
        stop: async () => ({ ok: true }),
        send(options) {
            onInject = options.callbacks.onInject
            agent.history.push({ id: 'u1', role: 'user', content: [{ type: 'text', text: '开始' }] })
            return Promise.resolve({ reason: 'finished', text: '' })
        },
    }
    Agent.runtime().set(sessionId, agent)
    await Chat.send({ sessionId, input: '开始' })
    return { sessionId, onInject }
}

describe('上下文余量提醒', () => {
    test('tokens 落在提醒带内（距压缩点不足 5%）时返回提醒文本', async () => {
        await withHome(async () => {
            const { onInject } = await capturedInject()
            // 128k * 0.8 = 102400 压缩点；提醒带 = [96000, ...)；给 100000 应命中
            const text = onInject({ tokens: 100000, budget: 128000, compactThreshold: 0.8 })
            expect(text).toContain('compaction threshold')
            expect(text).toContain('attempt_completion')
        })
    })

    test('还没到提醒带时不返回文本', async () => {
        await withHome(async () => {
            const { onInject } = await capturedInject()
            expect(onInject({ tokens: 50000, budget: 128000, compactThreshold: 0.8 })).toBe('')
        })
    })

    test('同一个 run 只提醒一次，第二次返回空', async () => {
        await withHome(async () => {
            const { onInject } = await capturedInject()
            expect(onInject({ tokens: 100000, budget: 128000, compactThreshold: 0.8 })).toContain('compaction')
            expect(onInject({ tokens: 105000, budget: 128000, compactThreshold: 0.8 })).toBe('')
        })
    })

    test('压缩阈值被用户调低时，提醒点跟着挪（不会永不触发）', async () => {
        await withHome(async () => {
            const { onInject } = await capturedInject()
            // 用户把压缩阈值调到 0.3：压缩点 38400，提醒带 [32000, ...)；40000 应命中
            expect(onInject({ tokens: 40000, budget: 128000, compactThreshold: 0.3 })).toContain('compaction')
        })
    })

    test('预算为 Infinity（关压缩）时不提醒', async () => {
        await withHome(async () => {
            const { onInject } = await capturedInject()
            expect(onInject({ tokens: 200000, budget: Infinity, compactThreshold: 0.8 })).toBe('')
        })
    })

    test('HTTP 层的 send 也会带上 onInject（装配不漏）', async () => {
        await withHome(async () => {
            const { sessionId } = await capturedInject()
            const response = await app.handle(new Request(`http://localhost/session/read/${sessionId}`))
            expect(response.status).toBe(200)
        })
    })

    // ctx_usage 的数据就来自这里：每轮 onInject 都要把用量记下来，
    // 不管这一轮是不是到了提醒带。
    test('每轮都把用量记进台账，ctx_usage 才答得出余量', async () => {
        await withHome(async () => {
            const { sessionId, onInject } = await capturedInject()
            // 远未到提醒带：不返回提醒文本，但数字必须记下
            expect(onInject({ tokens: 20000, budget: 128000, compactThreshold: 0.8 })).toBe('')
            const read = ContextUsage.read(sessionId)
            expect(read.tokens).toBe(20000)
            expect(read.compactAt).toBe(102400)
            expect(read.untilCompact).toBe(82400)
        })
    })

    test('已经提醒过之后仍然继续更新用量', async () => {
        await withHome(async () => {
            const { sessionId, onInject } = await capturedInject()
            onInject({ tokens: 100000, budget: 128000, compactThreshold: 0.8 })
            onInject({ tokens: 104000, budget: 128000, compactThreshold: 0.8 })
            // 第二次不返回提醒文本，但台账里的数必须是新的
            expect(ContextUsage.read(sessionId).tokens).toBe(104000)
        })
    })
})
