/*
 * agent-core 适配测试：把容易静默出错的那几处契约钉住。
 *
 * 这些错误有个共同点：不报错、测试也全绿，只有真机发请求或者模型行为不对才看得出来。
 * 所以这里查的是"交给 agent-core 的字段名对不对"，不是"功能通不通"。
 * 运行：cd server && bun test
 */
import { describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import Agent from '@kernel4632/agent-core'
import Config from '../commands/config.js'
import Session from '../commands/session.js'
import Settings from '../commands/settings.js'
import Store from '../store.js'

// 每个测试使用独立目录和干净的内存数据。
const withHome = async callback => {
    const root = join(tmpdir(), `agent-core-upgrade-${crypto.randomUUID()}`)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    Object.keys(Store.config).forEach(key => delete Store.config[key])
    Store.agents.clear()
    Store.sessions.clear()
    Store.snapshots.clear()
    Store.approvals.clear()
    Store.settings.clear()
    try {
        return await callback(root)
    } finally {
        if (previousHome === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previousHome
        await rm(root, { recursive: true, force: true })
    }
}

describe('context 预算与输出上限', () => {
    test('上下文预算写成 maxContextTokens，不是 maxTokens', async () => {
        await withHome(async () => {
            await Config.set({
                providers: [{
                    name: 'local',
                    models: ['model'],
                    modelSettings: { model: { context: 64000 } },
                }],
            })
            const config = Config.resolve({ provider: 'local', model: 'model' })

            // 这两个名字在 agent-core 0.26 起是两件不同的事：
            // maxContextTokens 是上下文预算（到 80% 自动压缩），
            // maxTokens 是单次生成的最大输出（会变成请求体的 maxOutputTokens）。
            // 写错不会报错，只会把 64000 当成输出上限发出去，模型被莫名截断。
            expect(config.maxContextTokens).toBe(64000)
            expect(config.maxTokens).toBeUndefined()
        })
    })

    test('没配上下文时也有默认预算，同样不落进 maxTokens', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }] })
            const config = Config.resolve({ provider: 'local', model: 'model' })
            expect(config.maxContextTokens).toBe(128000)
            expect(config.maxTokens).toBeUndefined()
        })
    })
})

describe('工具子集', () => {
    test('plan 模式用 Agent.tool.omit 去掉写工具，两份表一起被筛掉', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }] })
            const { sessionId } = await Session.create({ title: '只读模式' })
            await Session.saveSettings({ sessionId, mode: 'plan' })

            const { tools } = Store.agents.get(sessionId)
            // 写工具在 schema 里不该出现（模型看不到）……
            for (const name of Settings.WRITE_TOOLS) {
                expect(tools.schema[name], `${name} 不该在 plan 模式的 schema 里`).toBeUndefined()
            }
            // ……而且在 handlers 里也不该出现。只筛一份就会出现"看不见却还能被执行"。
            for (const name of Settings.WRITE_TOOLS) {
                expect(tools.handlers?.[name] === undefined || !(name in tools.handlers), `${name} 还能被执行`).toBe(true)
            }
            // 只读工具要留着，不然计划模式什么都干不了。
            expect(tools.schema.file_read).toBeDefined()
            expect(tools.schema.grep).toBeDefined()
        })
    })

    test('omit 返回的是新集合，原来的工具表不受影响', async () => {
        const scanned = await Agent.tool.scan(new URL('../tools/', import.meta.url))
        const before = Object.keys(scanned.schema).length

        const missing = Agent.tool.omit(scanned, ['file_write', 'shell']).schema
        expect(missing.file_write).toBeUndefined()
        expect(missing.shell).toBeUndefined()
        // 原集合还是完整的——子集是新对象，不是就地删。
        expect(Object.keys(scanned.schema)).toHaveLength(before)
        expect(scanned.schema.file_write).toBeDefined()
    })

    test('拿不存在或空的集合去 omit 不会炸', async () => {
        // agent-core 明确保证空集合和 undefined 也安全，这里把这条保证用起来。
        expect(() => Agent.tool.omit(undefined, ['file_write'])).not.toThrow()
        expect(() => Agent.tool.omit(Agent.tool.adopt(null), ['file_write'])).not.toThrow()
    })
})

describe('onPermission 的返回值', () => {
    test('审批回调只返回布尔值，不返回对象', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'allow' } })
            const { sessionId } = await Session.create({ title: '审批返回值' })

            // agent-core 0.26 起非 true 一律按拒绝处理（之前是"对象当真值＝放行"）。
            // 我们本来返回的就是布尔，这里钉住，免得以后为了带原因又改成对象——
            // 那会让所有工具都被拒绝，而且不报错。
            const callbacks = Store.agents.get(sessionId).callbacks
            const allowed = await callbacks.onPermission({ sessionId, toolCallId: 'c1', toolName: 'file_read', input: { path: 'D:/app/a.js' } })
            expect(typeof allowed).toBe('boolean')
            expect(allowed).toBe(true)
        })
    })

    test('被忽略规则拦住时返回 false，不是 false 一类的东西', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'allow' } })
            const { sessionId } = await Session.create({ title: '拦住密钥' })
            const callbacks = Store.agents.get(sessionId).callbacks

            const allowed = await callbacks.onPermission({ sessionId, toolCallId: 'c2', toolName: 'file_read', input: { path: 'D:/app/.env' } })
            expect(allowed).toBe(false)
        })
    })
})