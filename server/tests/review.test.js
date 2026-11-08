/*
 * 工具调用 AI 审核测试：审核器本身、审批关口接入和配置形状。
 *
 * 审核模型用假 chat 替换，不发起真实网络请求；审批仍然走真实的规则、工具表和 SSE。
 * 每个测试在自己的临时数据目录里跑，互不影响。
 * 运行：cd server && bun test
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import AgentCore from '@kernel4632/agent-core'
import Agent from '../features/agent.js'
import Approval from '../features/approval.js'
import History from '../features/history.js'
import Review from '../features/review.js'
import Path from '../utils/path.js'
import Settings from '../commands/settings.js'
import Tool from '../features/tool.js'
import store from '../store.js'
import SSE from '../utils/sse.js'
import '../server.js'

const realChat = options => AgentCore.llm.chat(options)
const fakeAgent = {
    taskModel: () => ({ provider: 'local', model: 'model' }),
    connection: () => ({ model: 'model', baseURL: 'http://127.0.0.1:1/v1', apiKey: '', protocol: 'chat', provider: { headers: {}, body: {} } }),
}

const withHome = async callback => {
    const root = join(tmpdir(), `agent-review-${crypto.randomUUID()}`)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    Path.lock(root)   // 锁定数据目录：晚到的异步收尾不会落到真实 ~/.agent
    Object.keys(store.config).forEach(key => delete store.config[key])
    delete store.sessions.s
    Agent.runtime().clear()
    History.clear()
    Approval.remove('s')
    try {
        return await callback(root)
    } finally {
        Approval.remove('s')
        Path.unlock()
        if (previousHome === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previousHome
        await rm(root, { recursive: true, force: true })
    }
}

afterEach(() => {
    Review.bind({ agent: Agent, chat: realChat })
})

const reply = text => async () => ({ text })

const configure = async ({ permission = { '*': 'review' }, review = { enabled: true }, extra = {} } = {}) => {
    await Settings.set({
        providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }],
        permission,
        review,
        ...extra,
    })
}

const check = (toolCallId, extra = {}) => Approval.check({
    sessionId: 's',
    toolCallId,
    toolName: 'execute_command',
    input: { command: 'ls' },
    ...extra,
})

const waitForPending = async (toolCallId, sessionId = 's') => {
    for (let index = 0; index < 200; index++) {
        if ((await Approval.pending(sessionId)).some(item => item.callID === toolCallId)) return
        await Bun.sleep(10)
    }
    throw new Error(`approval ${toolCallId} never appeared`)
}

describe('AI 审核器', () => {
    test('没启用时回到人工询问', async () => {
        await withHome(async () => {
            await configure({ review: { enabled: false } })
            Review.bind({ agent: fakeAgent, chat: reply('{"decision":"allow"}') })
            expect(await Review.check({ toolName: 'execute_command', input: { command: 'ls' } }))
                .toEqual({ decision: 'ask', reason: '未启用 AI 审核' })
        })
    })

    test('模型返回 allow / deny / ask 时原样交给审批关口', async () => {
        await withHome(async () => {
            await configure()
            Review.bind({ agent: fakeAgent, chat: reply('{"decision":"allow","reason":"只读"}') })
            expect(await Review.check({ toolName: 'execute_command', input: { command: 'ls' } }))
                .toEqual({ decision: 'allow', reason: '只读' })

            Review.bind({ agent: fakeAgent, chat: reply('{"decision":"deny","reason":"危险"}') })
            expect(await Review.check({ toolName: 'execute_command', input: { command: 'rm -rf /' } }))
                .toEqual({ decision: 'deny', reason: '危险' })

            Review.bind({ agent: fakeAgent, chat: reply('{"decision":"ask","reason":"不确定"}') })
            expect(await Review.check({ toolName: 'execute_command', input: { command: 'mv a b' } }))
                .toEqual({ decision: 'ask', reason: '不确定' })
        })
    })

    test('返回不是 JSON、字段不认识或请求失败时都按 ask 处理', async () => {
        await withHome(async () => {
            await configure()

            Review.bind({ agent: fakeAgent, chat: reply('我觉得可以执行') })
            expect((await Review.check({ toolName: 'execute_command', input: {} })).decision).toBe('ask')

            Review.bind({ agent: fakeAgent, chat: reply('{"decision":"maybe"}') })
            expect((await Review.check({ toolName: 'execute_command', input: {} })).decision).toBe('ask')

            Review.bind({ agent: fakeAgent, chat: async () => { throw new Error('网络挂了') } })
            const failed = await Review.check({ toolName: 'execute_command', input: {} })
            expect(failed.decision).toBe('ask')
            expect(failed.reason).toContain('网络挂了')
        })
    })

    test('审核请求带上工具、参数、目录和用户最后一句请求', async () => {
        await withHome(async () => {
            await configure()
            store.sessions.s = { cwd: '/tmp/work', history: { messages: [{ message: { role: 'user', content: '帮我看一下目录' } }] } }
            let captured = null
            Review.bind({ agent: fakeAgent, chat: async options => { captured = options; return { text: '{"decision":"allow","reason":"ok"}' } } })

            await Review.check({ sessionId: 's', toolName: 'execute_command', input: { command: 'ls' } })
            const prompt = captured.messages[1].content
            expect(captured.messages[0].content).toContain('工具调用审核员')
            expect(prompt).toContain('execute_command')
            expect(prompt).toContain('ls')
            expect(prompt).toContain('/tmp/work')
            expect(prompt).toContain('帮我看一下目录')
            expect(captured.stream).toBe(false)
        })
    })

    test('任务已取消时不发起审核请求，直接回到 ask', async () => {
        await withHome(async () => {
            await configure()
            let called = false
            Review.bind({ agent: fakeAgent, chat: async options => {
                called = true
                if (options.signal.aborted) throw new Error('aborted')
                return { text: '{"decision":"allow"}' }
            } })
            const controller = new AbortController()
            controller.abort()
            const result = await Review.check({ toolName: 'execute_command', input: {}, signal: controller.signal })
            expect(result.decision).toBe('ask')
            expect(called).toBe(true)
        })
    })
})

describe('审批关口接入 AI 审核', () => {
    test('review 结论为 allow 时直接执行，并推一条 permission-review', async () => {
        await withHome(async () => {
            await configure()
            Review.bind({ agent: fakeAgent, chat: reply('{"decision":"allow","reason":"只读命令"}') })
            const id = 'review-allow'
            const response = await SSE.connect({ id, request: new Request('http://localhost/sse') })
            const reader = response.body.getReader()

            expect(await check('a1', { sessionId: id })).toBe(true)
            const event = await Promise.race([reader.read(), Bun.sleep(500).then(() => null)])
            const text = new TextDecoder().decode(event.value)
            expect(text).toContain('permission-review')
            expect(text).toContain('只读命令')
            await SSE.close({ id })
        })
    })

    test('review 结论为 deny 时拒绝执行，原因进 permission-blocked', async () => {
        await withHome(async () => {
            await configure()
            Review.bind({ agent: fakeAgent, chat: reply('{"decision":"deny","reason":"删除系统目录"}') })
            const id = 'review-deny'
            const response = await SSE.connect({ id, request: new Request('http://localhost/sse') })
            const reader = response.body.getReader()

            expect(await check('a2', { sessionId: id, input: { command: 'rm -rf /' } })).toBe(false)
            const event = await Promise.race([reader.read(), Bun.sleep(500).then(() => null)])
            const text = new TextDecoder().decode(event.value)
            expect(text).toContain('permission-blocked')
            expect(text).toContain('AI 审核拒绝')
            expect(text).toContain('删除系统目录')
            await SSE.close({ id })
        })
    })

    test('review 结论为 ask 时回到人工审批，并带上审核原因', async () => {
        await withHome(async () => {
            await configure()
            Review.bind({ agent: fakeAgent, chat: reply('{"decision":"ask","reason":"目标不明确"}') })
            const pending = check('a3')
            await waitForPending('a3')

            const waiting = await Approval.pending('s')
            expect(waiting[0].review).toEqual({ reviewer: 'llm', decision: 'ask', reason: '目标不明确' })

            await Approval.decide({ sessionId: 's', toolCallId: 'a3', decision: 'allow-once' })
            expect(await pending).toBe(true)
        })
    })

    test('allow 和 deny 规则不调用审核器', async () => {
        await withHome(async () => {
            let calls = 0
            await configure({ permission: { '*': 'allow' } })
            Review.bind({ agent: fakeAgent, chat: async () => { calls += 1; return { text: '{"decision":"deny"}' } } })
            expect(await check('a4')).toBe(true)

            await configure({ permission: { '*': 'deny' } })
            expect(await check('a5')).toBe(false)
            expect(calls).toBe(0)
        })
    })

    test('对 review 动作点“始终允许”只记住这一组参数，同工具其他参数仍走审核', async () => {
        await withHome(async () => {
            await configure()
            Review.bind({ agent: fakeAgent, chat: reply('{"decision":"ask","reason":"要确认"}') })
            const pending = check('a6', { input: { command: 'make build' } })
            await waitForPending('a6')
            await Approval.decide({ sessionId: 's', toolCallId: 'a6', decision: 'allow-always' })
            expect(await pending).toBe(true)

            expect(store.config.permission.execute_command['*']).toBe('review')
            expect(store.config.permission.execute_command['make build*']).toBe('allow')

            let reviewed = 0
            Review.bind({ agent: fakeAgent, chat: async () => { reviewed += 1; return { text: '{"decision":"allow","reason":"ok"}' } } })
            expect(await check('a7', { input: { command: 'make deployed' } })).toBe(true)
            expect(reviewed).toBe(1) // 其他参数仍然走审核，而不是降级成人工询问
        })
    })

    test('等待中的审批改成 review 后，按 AI 结论结算', async () => {
        await withHome(async () => {
            await configure({ permission: { '*': 'ask' } })
            const pending = check('a8')
            await waitForPending('a8')

            Review.bind({ agent: fakeAgent, chat: reply('{"decision":"allow","reason":"规则允许"}') })
            await Settings.set({
                providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }],
                permission: { '*': 'review' },
                review: { enabled: true },
            })
            expect(await pending).toBe(true)
        })
    })
})

describe('审核配置', () => {
    test('review 配置写入后按当前形状读回，超时被夹到允许范围', async () => {
        await withHome(async () => {
            await Settings.set({
                providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }],
                review: { enabled: true, policy: '只允许只读操作', timeout: 999999 },
            })
            expect(store.config.review).toEqual({ enabled: true, policy: '只允许只读操作', timeout: 120000 })
            expect(store.config.models.review).toEqual({ provider: '', model: '' })

            await Settings.set({
                providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }],
                review: { enabled: 'yes', policy: 42, timeout: 'bad' },
            })
            expect(store.config.review).toEqual({ enabled: false, policy: '', timeout: 15000 })
        })
    })

    test('工具目录把 review 动作原样交给设置页', async () => {
        await withHome(async () => {
            await configure({ permission: { '*': 'review' } })
            const read = (await Tool.list()).find(tool => tool.name === 'read_file')
            expect(read.permission).toBe('review')
        })
    })
})
