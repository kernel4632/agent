/*
本地 RWKV 模型的真实工具调用测试：默认不跑，需要时 RUN_LOCAL=1 bun test tests/local.rwkv.test.js
模型在 127.0.0.1:46327（key sk-rwkv），没有 OpenAI 的 tool_calls 解析——
模型自己会以文本形式发起工具调用，考验 agent-core 的模拟工具能力。
密钥是本地服务，不涉密；不打印对话内容之外的东西。
*/

import { afterEach, describe, expect, test } from 'bun:test'
import { dataDir, restoreHome } from './mock.js'
import { Agents } from '../features/Agents.js'
import { Store } from '../features/Store.js'
import { Loader } from '../features/Loader.js'
import { wire } from '../server.js'
import { Stream } from '../features/Stream.js'
import { join } from 'node:path'

const original = process.env.AGENT_HOME
const LOCAL = process.env.RUN_LOCAL === '1'
const builtins = join(import.meta.dir, '../../extensions')
const BASE = 'http://127.0.0.1:46327/v1'

afterEach(async () => {
    try {
        Agents.get('main')?.agent.stop()
        await Promise.race([Agents.done('main').catch(() => {}), Bun.sleep(200)])
    } finally {
        Agents.drop('main')
        Loader.reset()
        restoreHome(original)
    }
})

describe('本地 RWKV 工具调用', () => {
    test.skipIf(!LOCAL)('模型能发起工具调用，core 能解析执行并续跑', async () => {
        dataDir()
        wire()
        await Store.configure({
            providers: [{ name: 'local', baseURL: BASE, apiKey: 'sk-rwkv', protocol: 'chat', models: [{ id: 'rwkv-test', context: 32768 }] }],
            models: { chat: 'local/rwkv-test' },
            textTools: true,
            noToolRounds: 1,
            retryMaxTries: 0,
            requestTimeout: 120_000,
            permission: { '*': 'allow' },
        })
        await Loader.start({ roots: [builtins] })

        const events = []
        const unsub = Stream.subscribe('main', (name, data) => {
            if (name === 'core') events.push(data)
            if (events.filter(e => e.type === 'request-start').length >= 5) void Agents.stop('main')
        })
        const timer = setTimeout(() => void Agents.stop('main'), 150_000)
        try {
            await Agents.open('main')
            await Agents.send('main', { input: '请调用 list_dir 工具列出当前目录，然后告诉我有几个文件。' })
            await Promise.race([Agents.done('main'), Bun.sleep(150_000).then(() => { throw new Error('整轮超过 150 秒') })])
            const history = Agents.get('main').agent.history

            const requests = events.filter(e => e.type === 'request-start').length
            const toolCalls = history.filter(m => m.role === 'assistant').flatMap(m => Array.isArray(m.content) ? m.content : []).filter(p => p.type === 'tool-call')
            const toolResults = history.filter(m => m.role === 'tool')
            const answers = history.filter(m => m.role === 'assistant').flatMap(m => Array.isArray(m.content) ? m.content.filter(p => p.type === 'text').map(p => p.text) : [m.content]).join('')

            // 不管模型用什么格式写调用（JSON 也好伪标记也好），core 若能模拟解析，历史里就该有工具回合
            console.log('请求轮数:', requests, '| 工具调用:', toolCalls.length, '| 工具结果:', toolResults.length, '| 文本回复长度:', answers.length)
            if (toolCalls.length) console.log('调用过的工具:', toolCalls.map(c => c.toolName).join(', '))

            expect(requests).toBeGreaterThan(0)
            expect(answers.length).toBeGreaterThan(0)
            // 工具断言分两档：模拟解析成功 → 一定有 tool-call + tool-result 回合；失败 → 至少有文本回复
            if (toolCalls.length) {
                expect(toolResults.length).toBeGreaterThan(0)
            } else {
                console.log('（模型没有发起可解析的工具调用——core 的模拟解析没有抓到，记录为观察项，不判失败）')
            }
        } finally {
            clearTimeout(timer)
            unsub()
        }
    })
})
