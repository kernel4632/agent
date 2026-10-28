/*
 * 交给 agent-core 的那份 config 里，每个字段都得真的在。
 *
 * 这一条是被真机打出来的：Config.resolve 漏了 model，agent-core 直接报
 * "model and messages are required"，不是启动时报，是每次发消息时报，
 * 表现是"这个 agent 一句话都说不出来"。65 个测试全绿，一个都没发现——
 * 因为测试从来不真的发模型请求，只看我们自己代码的返回值。
 *
 * 所以这里用一个假模型服务收请求体，看真实发出去的是什么，不看我们以为发了什么。
 * 运行：cd server && bun test
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import Agent from '@kernel4632/agent-core'
import Config from '../config/config.js'

// 每个测试用独立的临时数据目录，互不影响。
const withHome = async callback => {
    const root = join(tmpdir(), `agent-config-${crypto.randomUUID()}`)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    await mkdir(root, { recursive: true })
    try {
        return await callback()
    } finally {
        if (previousHome === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previousHome
        await rm(root, { recursive: true, force: true })
    }
}

/*
 * 起一个假的模型服务，把收到的请求体交出来。
 * 这是唯一能确认"模型名真的发出去了"的办法——看我们自己的返回值不够，
 * 漏字段正是在那一层发生的。
 */
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
                await Config.set({
                    providers: [{ name: 'fake', models: ['想用的模型'], baseURL: `http://127.0.0.1:${port}/v1` }],
                })

                // 用 resolve 真正产出的那份 config 去发一次请求，和我们实际用法一致。
                await Agent.llm.chat({
                    ...Config.resolve({ provider: 'fake', model: '想用的模型' }),
                    messages: [{ role: 'user', content: 'hi' }],
                    stream: false,
                })

                expect(seen).toHaveLength(1)
                // 漏了 model 时这里是 undefined，agent-core 会直接拒绝发请求。
                expect(seen[0].model).toBe('想用的模型')
            })
        })
    })

    test('思考强度按协议翻成请求体', async () => {
        await withHome(async () => {
            await Config.set({
                providers: [
                    { name: 'chat', models: ['m'], protocol: 'openai-compatible' },
                    { name: 'responses', models: ['m'], protocol: 'responses' },
                    { name: 'anthropic', models: ['m'], protocol: 'anthropic' },
                    { name: 'gemini', models: ['m'], protocol: 'gemini' },
                ],
            })
            const body = (provider, reasoning = 'low') => Config.resolve({ provider, model: 'm', settings: { reasoning } }).provider.body

            // OpenAI 兼容接口用顶层 reasoning_effort；auto 不写字段，off 明确要求关闭。
            expect(body('chat')).toEqual({ reasoning_effort: 'low' })
            expect(body('chat', 'auto')).toEqual({})
            expect(body('chat', 'off')).toEqual({ reasoning_effort: 'none' })
            // 其余协议字段名不同，跟各家接口文档一致。
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
                await Config.set({
                    providers: [{ name: 'fake', models: ['m'], baseURL: `http://127.0.0.1:${port}/v1` }],
                })
                const tools = Agent.tool.adopt({
                    attempt_completion: {
                        name: 'attempt_completion',
                        description: 'finish',
                        inputSchema: { type: 'object', properties: {} },
                        execute: () => ({ stop: true, output: { type: 'text', value: 'ok' } }),
                    },
                })
                const agent = Agent.create({
                    history: [],
                    config: { ...Config.resolve({ provider: 'fake', model: 'm' }), stream: false },
                    tools,
                })

                const result = await agent.send({ input: '你好' })
                expect(result.reason).toBe('no-tool')
                expect(seen).toHaveLength(1)
            })
        })
    })

    test('resolve 返回的字段里有 model', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['m1'] }] })
            const config = Config.resolve({ provider: 'local', model: 'm1' })
            // 直接盯字段本身：少了它，任何模型请求都发不出去。
            expect(config.model).toBe('m1')
        })
    })

    test('会话选的那个模型就是要用的那个，不是配置里的第一个', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['第一个', '第二个'] }] })
            // 用户明确选了第二个，就必须用第二个。取第一个的话用户永远切不了模型。
            const config = Config.resolve({ provider: 'local', model: '第二个' })
            expect(config.model).toBe('第二个')
        })
    })

    test('请求头不是合法 JSON 时按用户填错处理，不抛程序异常', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['m'], headers: '{' }] })
            // 设置页允许直接编辑 JSON 文本；写坏了要告诉用户，而不是让服务器崩成 500。
            expect(() => Config.connection({ provider: 'local', model: 'm' })).toThrow(/headers must be valid JSON/i)
        })
    })
})
