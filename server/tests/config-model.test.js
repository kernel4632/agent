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
import Settings from '../commands/settings.js'
import store from '../store.js'
// 有状态模块在服务入口装配；单独 import 命令时也要走一遍，和启动时是同一条路径。
import '../server.js'

// 每个测试用独立的临时数据目录，互不影响。
const withHome = async callback => {
    const root = join(tmpdir(), `agent-config-${crypto.randomUUID()}`)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    await mkdir(root, { recursive: true })
    Object.keys(store.config).forEach(key => delete store.config[key])
    try {
        return await callback()
    } finally {
        if (previousHome === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previousHome
        await rm(root, { recursive: true, force: true })
    }
}

const resolve = ({ provider, model, settings = {} }) => Agent.resolve({
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
                    config: { ...resolve({ provider: 'fake', model: 'm' }), maxContextTokens: 1000, compactThreshold: 0.1 },
                    callbacks: {},
                })
                const events = []
                const result = await agent.send({
                    input: '很长的记录。'.repeat(400),
                    callbacks: { onLLMEvent: event => events.push(event), onCompact: event => events.push(event) },
                })

                expect(requests.length).toBeGreaterThanOrEqual(2)
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
                    history: [], config: { ...resolve({ provider: 'fake', model: 'm' }), stream: false }, tools,
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
                    ...resolve({ provider: 'fake', model: '想用的模型' }),
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
            const body = (provider, reasoning = 'low') => resolve({ provider, model: 'm', settings: { reasoning } }).provider.body

            expect(body('chat')).toEqual({ reasoning_effort: 'low' })
            expect(body('chat', 'auto')).toEqual({})
            expect(body('chat', 'off')).toEqual({ reasoning_effort: 'none' })
            expect(body('responses')).toEqual({ reasoning: { effort: 'low' } })
            expect(body('anthropic')).toEqual({
                thinking: { type: 'adaptive', display: 'summarized' },
                output_config: { effort: 'low' },
            })
            expect(body('gemini')).toEqual({
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
                    config: { ...resolve({ provider: 'fake', model: 'm' }), stream: false },
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
            const config = resolve({ provider: 'local', model: 'model' })
            expect(config.maxContextTokens).toBe(64000)
            expect(config.maxTokens).toBeUndefined()
        })
    })

    test('没配上下文时也有默认预算', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }] })
            expect(resolve({ provider: 'local', model: 'model' }).maxContextTokens).toBe(128000)
        })
    })

    test('resolve 返回的字段里有 model', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'm1', name: 'm1' }] }] })
            expect(resolve({ provider: 'local', model: 'm1' }).model).toBe('m1')
        })
    })

    test('会话选的那个模型就是要用的那个，不是配置里的第一个', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: '第一个', name: '第一个' }, { id: '第二个', name: '第二个' }] }] })
            expect(resolve({ provider: 'local', model: '第二个' }).model).toBe('第二个')
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
            const config = resolve({ provider: 'local', model: 'm' })
            expect(config.capabilities.tools).toBe(true)
            expect(config.capabilities.image).toBe(false)
        })
    })

    test('请求头不是合法 JSON 时按用户填错处理，不抛程序异常', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'm', name: 'm' }], headers: '{' }] })
            expect(() => Agent.connection({ provider: 'local', model: 'm' })).toThrow(/headers must be valid JSON/i)
        })
    })
})
