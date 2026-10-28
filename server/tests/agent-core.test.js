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

import AgentCore from '@kernel4632/agent-core'
import Agent from '../features/agent.js'
import Config from '../commands/config.js'
import Session from '../commands/session.js'
import History from '../features/history.js'
import store from '../store.js'

// 每个测试使用独立目录和干净的内存数据。
const withHome = async callback => {
    const root = join(tmpdir(), `agent-core-upgrade-${crypto.randomUUID()}`)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    Object.keys(store.config).forEach(key => delete store.config[key])
    Agent.runtime().clear()
    History.clear()
    try {
        return await callback(root)
    } finally {
        if (previousHome === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previousHome
        await rm(root, { recursive: true, force: true })
    }
}

describe('工具子集', () => {
    test('omit 返回的是新集合，原来的工具表不受影响', async () => {
        const scanned = await AgentCore.tool.scan(new URL('../tools/', import.meta.url))
        const before = Object.keys(scanned.schema).length

        const missing = AgentCore.tool.omit(scanned, ['write_to_file', 'execute_command']).schema
        expect(missing.write_to_file).toBeUndefined()
        expect(missing.execute_command).toBeUndefined()
        expect(Object.keys(scanned.schema)).toHaveLength(before)
        expect(scanned.schema.write_to_file).toBeDefined()
    })

    test('拿不存在或空的集合去 omit 不会炸', async () => {
        expect(() => AgentCore.tool.omit(undefined, ['write_to_file'])).not.toThrow()
        expect(() => AgentCore.tool.omit(AgentCore.tool.adopt(null), ['write_to_file'])).not.toThrow()
    })
})

describe('onPermission 的返回值', () => {
    test('审批回调只返回布尔值，不返回对象', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'allow' } })
            const { sessionId } = await Session.create({ title: '审批返回值' })

            const callbacks = Agent.runtime().get(sessionId).callbacks
            const allowed = await callbacks.onPermission({ sessionId, toolCallId: 'c1', toolName: 'read_file', input: { path: 'D:/app/a.js' } })
            expect(typeof allowed).toBe('boolean')
            expect(allowed).toBe(true)
        })
    })

    test('deny 规则返回 false，不是 false 一类的东西', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'deny' } })
            const { sessionId } = await Session.create({ title: '拒绝读取' })
            const callbacks = Agent.runtime().get(sessionId).callbacks

            const allowed = await callbacks.onPermission({ sessionId, toolCallId: 'c2', toolName: 'read_file', input: { path: 'D:/app/a.js' } })
            expect(allowed).toBe(false)
        })
    })
})
