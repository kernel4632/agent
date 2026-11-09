/*
 * 交给 agent-core 的那份 config 里，每个字段都得真的在。
 *
 * 这一条是被真机打出来的：配置漏了 model，agent-core 直接报
 * "model and messages are required"，不是启动时报，是每次发消息时报。
 * 所以这里用假模型服务看真实发出去的请求体。
 * 运行：cd server && bun test
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import AgentCore from '@kernel4632/agent-core'
import Agent from '../features/agent.js'
import Path from '../utils/path.js'
import Settings from '../commands/settings.js'
import store from '../store.js'
// 有状态模块在服务入口装配；单独 import 命令时也要走一遍，和启动时是同一条路径。
import '../server.js'

// 每个测试用独立的临时数据目录，互不影响。
const withHome = async callback => {
    const root = join(tmpdir(), `agent-config-${crypto.randomUUID()}`)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    Path.lock(root)   // 锁定数据目录：晚到的异步收尾不会落到真实 ~/.agent
    await mkdir(root, { recursive: true })
    Object.keys(store.config).forEach(key => delete store.config[key])
    try {
        return await callback()
    } finally {
        Path.unlock()
        if (previousHome === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previousHome
        await rm(root, { recursive: true, force: true })
    }
}

const resolve = async ({ provider, model, settings = {} }) => Agent.resolve({
    session: { model: { provider, model } },
    settings: { ...Agent.defaultSettings(), ...settings },
})

// 起一个假模型服务，把收到的请求体交出来。
const withFakeModel = async (callback, respond) => {
    const seen = []
    const server = Bun.serve({
        port: 0,
        async fetch(request) {
            const body = await request.json().catch(() => null)
            seen.push(body)
            return Response.json(respond
                ? await respond(body, seen.length)
                : {
                    id: 'fake', object: 'chat.completion', created: Date.now(), model: 'fake',
                    choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
                    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
                })
        },
    })
    try {
        return await callback({ port: server.port, seen })
    } finally {
        await server.stop(true)
    }
}

describe('交给 agent-core 的 config', () => {
    test('自动压缩：增量独立标记，任务用量包含压缩请求', async () => {
        await withHome(async () => {
            const requests = []
            const server = Bun.serve({ port: 0, async fetch(request) {
                const body = await request.json()
                requests.push(body)
                const compact = body.messages.at(-1)?.content?.includes?.('压缩成一段总结')
                return new Response(new ReadableStream({
                    async start(controller) {
                        for (const chunk of [
                            { choices: [{ index: 0, delta: { role: 'assistant', content: compact ? '压缩摘要' : '正常答案' } }] },
                            { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: compact
                                ? { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 }
                                : { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 } },
                        ]) {
                            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ id: 'stream', object: 'chat.completion.chunk', created: 1, model: 'fake', ...chunk })}\n\n`))
                        }
                        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
                        controller.close()
                    },
                }), { headers: { 'content-type': 'text/event-stream' } })
            } })
            try {
                await Settings.set({
                    providers: [{ name: 'fake', models: [{ id: 'm', context: 1000, capabilities: ['text'] }], baseURL: `http://127.0.0.1:${server.port}/v1`, stream: true }],
                })
                const agent = AgentCore.create({
                    history: [],
                    config: { ...await resolve({ provider: 'fake', model: 'm' }), maxContextTokens: 1000, compactThreshold: 0.1 },
                    callbacks: {},
                })
                const events = []
                const result = await agent.send({
                    input: '很长的记录。'.repeat(400),
                    callbacks: { onLLMEvent: event => events.push(event), onCompact: event => events.push(event) },
                })

                expect(requests.length).toBeGreaterThanOrEqual(2)
                // 自动压缩也必须收到我们追加的详细 Markdown 规范。
                const compactRequest = requests.find(request => request.messages.at(-1)?.content?.includes?.('压缩成一段总结'))
                expect(compactRequest.messages.find(message => message.role === 'system')?.content).toContain('上下文压缩')
                const compactEvents = events.filter(event => event.request === 'compact' || event.type.startsWith('compact-'))
                expect(compactEvents.some(event => event.type === 'text-delta' && event.request === 'compact')).toBe(true)
                expect(compactEvents.find(event => event.type === 'compact-finish')).toMatchObject({
                    content: '压缩摘要', usage: { inputTokens: 7, outputTokens: 2, totalTokens: 9 },
                })
                expect(agent.history.some(message => message.compact)).toBe(true)
                expect(result.text).toBe('正常答案')
                expect(result.usage).toMatchObject({ inputTokens: 18, outputTokens: 5, totalTokens: 23 })
            } finally {
                await server.stop(true)
            }
        })
    })

    test('拒绝工具也回调完整 onToolResult 和 onStep.toolResults', async () => {
        await withHome(async () => {
            await withFakeModel(async ({ port }) => {
                await Settings.set({ providers: [{ name: 'fake', models: [{ id: 'm', name: 'm' }], baseURL: `http://127.0.0.1:${port}/v1` }] })
                const tools = AgentCore.tool.adopt({
                    read: { name: 'read', inputSchema: { type: 'object', properties: {} }, execute: () => 'must not execute' },
                })
                const agent = AgentCore.create({
                    history: [], config: { ...await resolve({ provider: 'fake', model: 'm' }), stream: false }, tools,
                })
                const callbacks = []
                const result = await agent.send({ input: '拒绝工具', callbacks: {
                    onPermission: () => false,
                    onToolResult: item => callbacks.push(item),
                    onStep: step => { if (step.toolCalls.length) callbacks.push(...step.toolResults) },
                } })
                expect(result.reason).toBe('no-tool')
                expect(callbacks.length).toBeGreaterThanOrEqual(2)
                expect(callbacks[0]).toMatchObject({ toolName: 'read', output: { type: 'execution-denied' } })
                expect(callbacks[1]).toMatchObject({ call: { toolName: 'read' }, output: { type: 'execution-denied' } })
            }, (_body, count) => ({
                id: 'fake', object: 'chat.completion', created: Date.now(), model: 'fake',
                choices: [{ index: 0, message: count === 1
                    ? { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read', arguments: '{}' } }] }
                    : { role: 'assistant', content: '已收到拒绝' }, finish_reason: count === 1 ? 'tool_calls' : 'stop' }],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }))
        })
    })

    test('模型名真的出现在请求体里', async () => {
        await withHome(async () => {
            await withFakeModel(async ({ port, seen }) => {
                await Settings.set({
                    providers: [{ name: 'fake', models: [{ id: '想用的模型', name: '想用的模型' }], baseURL: `http://127.0.0.1:${port}/v1` }],
                })

                await AgentCore.llm.chat({
                    ...await resolve({ provider: 'fake', model: '想用的模型' }),
                    messages: [{ role: 'user', content: 'hi' }],
                    stream: false,
                })

                expect(seen).toHaveLength(1)
                expect(seen[0].model).toBe('想用的模型')
            })
        })
    })

    test('思考强度按协议翻成请求体', async () => {
        await withHome(async () => {
            await Settings.set({
                providers: [
                    { name: 'chat', models: [{ id: 'm', name: 'm' }], protocol: 'openai-compatible' },
                    { name: 'responses', models: [{ id: 'm', name: 'm' }], protocol: 'responses' },
                    { name: 'anthropic', models: [{ id: 'm', name: 'm' }], protocol: 'anthropic' },
                    { name: 'gemini', models: [{ id: 'm', name: 'm' }], protocol: 'gemini' },
                ],
            })
            const body = async (provider, reasoning = 'low') => (await resolve({ provider, model: 'm', settings: { reasoning } })).provider.body

            expect(await body('chat')).toEqual({ reasoning_effort: 'low' })
            expect(await body('chat', 'auto')).toEqual({})
            expect(await body('chat', 'off')).toEqual({ reasoning_effort: 'none' })
            expect(await body('responses')).toEqual({ reasoning: { effort: 'low' } })
            expect(await body('anthropic')).toEqual({
                thinking: { type: 'adaptive', display: 'summarized' },
                output_config: { effort: 'low' },
            })
            expect(await body('gemini')).toEqual({
                generationConfig: { thinkingConfig: { thinkingBudget: 1000, includeThoughts: true } },
            })
        })
    })

    test('模型不调工具时最多追问三轮，第三轮前提醒用结束工具', async () => {
        await withHome(async () => {
            await withFakeModel(async ({ port, seen }) => {
                await Settings.set({
                    providers: [{ name: 'fake', models: [{ id: 'm', name: 'm' }], baseURL: `http://127.0.0.1:${port}/v1` }],
                })
                const tools = AgentCore.tool.adopt({
                    attempt_completion: {
                        name: 'attempt_completion',
                        description: 'finish',
                        inputSchema: { type: 'object', properties: {} },
                        execute: () => ({ stop: true, output: { type: 'text', value: 'ok' } }),
                    },
                })
                const agent = AgentCore.create({
                    history: [],
                    config: { ...await resolve({ provider: 'fake', model: 'm' }), stream: false },
                    tools,
                })

                const result = await agent.send({ input: '你好' })
                expect(result.reason).toBe('no-tool')
                expect(seen).toHaveLength(3)
                // 最后一轮请求带着“必须用工具收尾”的提醒。
                expect(JSON.stringify(seen[2])).toContain('attempt_completion')
            })
        })
    })

    test('上下文预算写成 maxContextTokens，不是 maxTokens', async () => {
        await withHome(async () => {
            await Settings.set({
                providers: [{
                    name: 'local',
                    models: [{ id: 'model', context: 64000 }],
                }],
            })
            const config = await resolve({ provider: 'local', model: 'model' })
            expect(config.maxContextTokens).toBe(64000)
            expect(config.maxTokens).toBeUndefined()
        })
    })

    test('模型高级生成参数进入 core 配置', async () => {
        await withHome(async () => {
            await Settings.set({
                providers: [{
                    name: 'local',
                    models: [{
                        id: 'model',
                        context: 64000,
                        maxOutput: 8192,
                        temperature: 0.3,
                        topP: 0.9,
                        seed: 42,
                        body: { top_k: 20 },
                    }],
                }],
            })
            const config = await resolve({ provider: 'local', model: 'model' })
            expect(config.maxTokens).toBe(8192)
            expect(config.provider.temperature).toBe(0.3)
            expect(config.provider.topP).toBe(0.9)
            expect(config.provider.seed).toBe(42)
            expect(config.provider.body).toEqual({ top_k: 20 })
        })
    })

    test('没配上下文时也有默认预算', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }] })
            expect((await resolve({ provider: 'local', model: 'model' })).maxContextTokens).toBe(128000)
        })
    })

    test('resolve 返回的字段里有 model', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'm1', name: 'm1' }] }] })
            expect((await resolve({ provider: 'local', model: 'm1' })).model).toBe('m1')
        })
    })

    test('模型请求使用 agent-core 的无限重试，只把单次退避上限收紧到 120s', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'm1', name: 'm1' }] }] })
            const config = await resolve({ provider: 'local', model: 'm1' })
            expect(config.retryMaxDelay).toBe(120000)
            // 基数和总时长不覆盖，继续使用 core 的 5000ms / 无限总时长。
            expect(config.retryBaseDelay).toBeUndefined()
            expect(config.retryMaxElapsed).toBeUndefined()
        })
    })

    test('5xx 失败后继续请求，直到模型恢复', async () => {
        await withHome(async () => {
            let attempts = 0
            const server = Bun.serve({
                port: 0,
                async fetch() {
                    attempts += 1
                    if (attempts < 3) {
                        return new Response(JSON.stringify({ error: { message: 'temporary upstream failure' } }), {
                            status: 500,
                            headers: { 'content-type': 'application/json' },
                        })
                    }
                    return Response.json({
                        id: 'retry', object: 'chat.completion', created: Date.now(), model: 'm',
                        choices: [{ index: 0, message: { role: 'assistant', content: '恢复了' }, finish_reason: 'stop' }],
                        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
                    })
                },
            })
            try {
                await Settings.set({ providers: [{ name: 'fake', models: [{ id: 'm', capabilities: ['text'] }], baseURL: `http://127.0.0.1:${server.port}/v1`, stream: false }] })
                const config = {
                    ...await resolve({ provider: 'fake', model: 'm' }),
                    stream: false,
                    retryBaseDelay: 1,
                    retryMaxDelay: 1,
                }
                const agent = AgentCore.create({ history: [], config, callbacks: {} })
                const result = await agent.send({ input: '重试一下' })
                expect(attempts).toBe(3)
                expect(result.text).toContain('恢复了')
            } finally {
                await server.stop(true)
            }
        })
    })

    test('400 请求错误不进入无限重试', async () => {
        await withHome(async () => {
            let attempts = 0
            const server = Bun.serve({
                port: 0,
                async fetch() {
                    attempts += 1
                    return new Response(JSON.stringify({ error: { message: 'reasoning_content missing' } }), {
                        status: 400,
                        headers: { 'content-type': 'application/json' },
                    })
                },
            })
            try {
                await Settings.set({ providers: [{ name: 'fake', models: [{ id: 'm', capabilities: ['text'] }], baseURL: `http://127.0.0.1:${server.port}/v1`, stream: false }] })
                const config = { ...await resolve({ provider: 'fake', model: 'm' }), stream: false, retryBaseDelay: 1, retryMaxDelay: 1 }
                const agent = AgentCore.create({ history: [], config, callbacks: {} })
                await expect(agent.send({ input: '不应重试' })).rejects.toBeTruthy()
                expect(attempts).toBe(1)
            } finally {
                await server.stop(true)
            }
        })
    })

    test('会话选的那个模型就是要用的那个，不是配置里的第一个', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: '第一个', name: '第一个' }, { id: '第二个', name: '第二个' }] }] })
            expect((await resolve({ provider: 'local', model: '第二个' })).model).toBe('第二个')
        })
    })

    test('模型能力写成中文时也能认出工具能力', async () => {
        await withHome(async () => {
            await Settings.set({
                providers: [{
                    name: 'local',
                    models: [{ id: 'm', capabilities: ['文本', '工具'] }],
                }],
            })
            const config = await resolve({ provider: 'local', model: 'm' })
            expect(config.capabilities.tools).toBe(true)
            expect(config.capabilities.image).toBe(false)
            expect(config.capabilities.reasoning).toBe(false)
        })
    })

    test('声明回传思考能力的模型打开 reasoning 回传', async () => {
        await withHome(async () => {
            await Settings.set({
                providers: [{ name: 'local', models: [{ id: 'm', capabilities: ['text', 'tools', 'reasoning', 'reasoning-replay'] }] }],
            })
            const config = await resolve({ provider: 'local', model: 'm' })
            expect(config.capabilities.reasoning).toBe(true)
        })
    })

    test('声明推理能力的模型历史 reasoning 真的进入请求体', async () => {
        await withHome(async () => {
            await withFakeModel(async ({ port, seen }) => {
                await Settings.set({
                    providers: [{ name: 'fake', models: [{ id: 'm', capabilities: ['text', 'tools', 'reasoning', 'reasoning-replay'] }], baseURL: `http://127.0.0.1:${port}/v1`, stream: false }],
                })
                const config = { ...await resolve({ provider: 'fake', model: 'm' }), stream: false }
                const agent = AgentCore.create({
                    history: [
                        { id: 'u1', role: 'user', content: [{ type: 'text', text: '开始' }] },
                        { id: 'a1', role: 'assistant', content: [
                            { type: 'reasoning', text: '先思考' },
                            { type: 'tool-call', toolCallId: 'c1', toolName: 'noop', input: {} },
                        ] },
                        { id: 't1', role: 'tool', content: [
                            { type: 'tool-result', toolCallId: 'c1', toolName: 'noop', output: { type: 'text', value: 'ok' } },
                        ] },
                    ],
                    config,
                })
                await agent.send({ input: '继续' })
                const assistant = seen[0].messages.find(message => message.role === 'assistant' && message.tool_calls)
                expect(assistant.reasoning_content).toBe('先思考')
            })
        })
    })

    test('请求头不是合法 JSON 时按用户填错处理，不抛程序异常', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'm', name: 'm' }], headers: '{' }] })
            expect(() => Agent.connection({ provider: 'local', model: 'm' })).toThrow(/headers must be valid JSON/i)
        })
    })
})
