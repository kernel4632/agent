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
const withFakeModel = async callback => {
    const seen = []
    const server = Bun.serve({
        port: 0,
        async fetch(request) {
            seen.push(await request.json().catch(() => null))
            return Response.json({
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
    test('模型名真的出现在请求体里', async () => {
        await withHome(async () => {
            await withFakeModel(async ({ port, seen }) => {
                await Settings.set({
                    providers: [{ name: 'fake', models: ['想用的模型'], baseURL: `http://127.0.0.1:${port}/v1` }],
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
                    { name: 'chat', models: ['m'], protocol: 'openai-compatible' },
                    { name: 'responses', models: ['m'], protocol: 'responses' },
                    { name: 'anthropic', models: ['m'], protocol: 'anthropic' },
                    { name: 'gemini', models: ['m'], protocol: 'gemini' },
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

    test('模型没有调用工具时只请求一次，不会把回答显示两遍', async () => {
        await withHome(async () => {
            await withFakeModel(async ({ port, seen }) => {
                await Settings.set({
                    providers: [{ name: 'fake', models: ['m'], baseURL: `http://127.0.0.1:${port}/v1` }],
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
                expect(seen).toHaveLength(1)
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
            await Settings.set({ providers: [{ name: 'local', models: ['model'] }] })
            expect(resolve({ provider: 'local', model: 'model' }).maxContextTokens).toBe(128000)
        })
    })

    test('resolve 返回的字段里有 model', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: ['m1'] }] })
            expect(resolve({ provider: 'local', model: 'm1' }).model).toBe('m1')
        })
    })

    test('会话选的那个模型就是要用的那个，不是配置里的第一个', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: ['第一个', '第二个'] }] })
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

    test('旧配置的 model、uses、compactThreshold 会迁移成新字段', async () => {
        await withHome(async () => {
            await Settings.set({
                providers: [{
                    name: 'local',
                    models: ['m'],
                    modelSettings: { m: { context: 32000 } },
                }],
                model: { provider: 'local', model: 'm' },
                uses: { compact: { provider: 'local', model: 'm' } },
                compactThreshold: 0.5,
            })

            expect(store.config.models.chat).toEqual({ provider: 'local', model: 'm' })
            expect(store.config.models.compact).toEqual({ provider: 'local', model: 'm' })
            expect(store.config.compact.threshold).toBe(0.5)
            expect(store.config.model).toBeUndefined()
            expect(store.config.uses).toBeUndefined()
            expect(store.config.providers[0].models[0].context).toBe(32000)
            expect(resolve({ provider: 'local', model: 'm' }).maxContextTokens).toBe(32000)
        })
    })

    test('请求头不是合法 JSON 时按用户填错处理，不抛程序异常', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: ['m'], headers: '{' }] })
            expect(() => Agent.connection({ provider: 'local', model: 'm' })).toThrow(/headers must be valid JSON/i)
        })
    })
})
