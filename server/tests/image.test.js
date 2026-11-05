/*
 * 图片输入：内容块数组随用户消息进 history；请求前按模型能力决定是否剔除图片。
 *
 * 用假模型服务看真实请求体：没开 image 能力的模型只收到文字；开了的收到完整图片。
 * history 里图片常驻——切换模型后仍然完整，这是前端能“随便切模型”的前提。
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import AgentCore from '@kernel4632/agent-core'
import Agent from '../features/agent.js'
import Path from '../utils/path.js'
import Settings from '../commands/settings.js'
import Chat from '../commands/chat.js'
import store from '../store.js'
import '../server.js'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='
const withHome = async callback => {
    const root = join(tmpdir(), `agent-image-${crypto.randomUUID()}`)
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

// 起一个假模型服务：记录每次请求体，回一句固定的话。
const withFakeModel = async callback => {
    const seen = []
    const server = Bun.serve({
        port: 0,
        async fetch(request) {
            const body = await request.json().catch(() => null)
            seen.push(body)
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

describe('图片输入', () => {
    test('没开 image 能力时，请求体里只有文字，图片被剔除', async () => {
        await withHome(async () => {
            await withFakeModel(async ({ port, seen }) => {
                await Settings.set({
                    providers: [{ name: 'fake', models: [{ id: 'm', capabilities: ['text', 'tools'] }], baseURL: `http://127.0.0.1:${port}/v1` }],
                })
                const agent = AgentCore.create({
                    history: [],
                    config: { ...await resolve({ provider: 'fake', model: 'm' }), stream: false },
                })
                await agent.send({ input: [{ type: 'text', text: '看这张图' }, { type: 'image', image: PNG }] })

                expect(seen).toHaveLength(1)
                const sent = seen[0].messages.find(message => message.role === 'user')
                expect(JSON.stringify(sent)).toContain('看这张图')
                expect(JSON.stringify(sent)).not.toContain('iVBORw0KGgo')
                // history 里图片常驻：切模型后仍然完整。
                expect(JSON.stringify(agent.history.find(message => message.role === 'user'))).toContain('iVBORw0KGgo')
            })
        })
    })

    test('开了 image 能力时，图片原样发给模型', async () => {
        await withHome(async () => {
            await withFakeModel(async ({ port, seen }) => {
                await Settings.set({
                    providers: [{ name: 'fake', models: [{ id: 'm', capabilities: ['text', 'tools', 'image'] }], baseURL: `http://127.0.0.1:${port}/v1` }],
                })
                const agent = AgentCore.create({
                    history: [],
                    config: { ...await resolve({ provider: 'fake', model: 'm' }), stream: false },
                })
                await agent.send({ input: [{ type: 'text', text: '看这张图' }, { type: 'image', image: PNG }] })

                const sent = seen[0].messages.find(message => message.role === 'user')
                expect(JSON.stringify(sent)).toContain('iVBORw0KGgo')
            })
        })
    })

    test('非法图片块在启动前就报 400，不进历史', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'm', name: 'm' }] }] })
            await expect(Chat.send({ sessionId: '不存在的会话', input: [{ type: 'image', image: 'not-a-url' }] }))
                .rejects.toMatchObject({ status: 400 })
        })
    })
})
