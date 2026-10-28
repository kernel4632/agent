/*
 * 回退与文件快照测试：工具级回退、消息级回退和敏感文件。
 *
 * 回退同时改历史、磁盘文件和撤销栈，三者之间不一致就会留下
 * "对话退回去了但文件没退"这种状态，所以单独一个文件盯住它。
 * 每个测试在自己的临时数据目录里跑，互不影响。
 * 运行：cd server && bun test
 */
import { describe, expect, test } from 'bun:test'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import AgentCore from '@kernel4632/agent-core'

import Approval from '../features/approval.js'
import Agent from '../features/agent.js'
import Config from '../commands/config.js'
import History from '../features/history.js'
import Session from '../commands/session.js'
import * as File from '../tools/file.js'
import store from '../store.js'

// 每个测试使用独立目录和干净的内存数据。
const withHome = async callback => {
    const root = join(tmpdir(), `agent-rollback-${crypto.randomUUID()}`)
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

const tempFile = async (prefix, content) => {
    const path = join(tmpdir(), `${prefix}-${crypto.randomUUID()}.txt`)
    await writeFile(path, content)
    return path
}

describe('工具级回退', () => {
    test('只退指定的那一次工具调用，别的调用成果保留', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'allow' } })
            const first = await tempFile('agent-tool-a', 'a0')
            const second = await tempFile('agent-tool-b', 'b0')

            const { sessionId } = await Session.create({ title: 'Tool rollback' })
            const added = await History.add({ sessionId, message: AgentCore.history.user({ content: '改两个文件' }) })
            await History.save(sessionId)
            const messageId = added.message.id

            await Approval.check({ sessionId, messageId, toolCallId: 'call-a', toolName: 'write_to_file', input: { path: first } })
            await writeFile(first, 'a1')
            await Approval.check({ sessionId, messageId, toolCallId: 'call-b', toolName: 'write_to_file', input: { path: second } })
            await writeFile(second, 'b1')

            expect((await Session.toolChanges({ sessionId })).map(entry => entry.toolCallId)).toEqual(['call-a', 'call-b'])

            const result = await Session.rollbackTool({ sessionId, toolCallId: 'call-b' })
            expect(result.restored).toContain(resolve(second))
            expect(await readFile(second, 'utf8')).toBe('b0')
            expect(await readFile(first, 'utf8')).toBe('a1')
            expect((await Session.toolChanges({ sessionId })).map(entry => entry.toolCallId)).toEqual(['call-a'])

            await Session.redo({ sessionId })
            expect(await readFile(second, 'utf8')).toBe('b1')

            await Session.rollbackTool({ sessionId, toolCallId: 'call-b', files: false })
            expect(await readFile(second, 'utf8')).toBe('b1')
            expect((await Session.toolChanges({ sessionId })).map(entry => entry.toolCallId)).toEqual(['call-a'])

            await rm(first, { force: true })
            await rm(second, { force: true })
        })
    })

    test('退一个不存在的工具调用按填错处理', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }] })
            const { sessionId } = await Session.create({ title: 'No such call' })
            await expect(Session.rollbackTool({ sessionId, toolCallId: 'never-happened' })).rejects.toThrow(/not found/i)
        })
    })

    test('工具级回退不改变对话历史', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'allow' } })
            const target = await tempFile('agent-keep-history', 'before')

            const { sessionId } = await Session.create({ title: 'History stays' })
            const added = await History.add({ sessionId, message: AgentCore.history.user({ content: '改一个文件' }) })
            await History.save(sessionId)

            await Approval.check({ sessionId, messageId: added.message.id, toolCallId: 'call-x', toolName: 'write_to_file', input: { path: target } })
            await writeFile(target, 'after')

            await Session.rollbackTool({ sessionId, toolCallId: 'call-x' })
            expect((await Session.read({ sessionId })).history).toHaveLength(1)
            expect(await readFile(target, 'utf8')).toBe('before')

            await rm(target, { force: true })
        })
    })

    test('连续改同一个文件时，回退后一次会恢复成前一次的结果', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'allow' } })
            const target = await tempFile('agent-twice', 'v0')

            const { sessionId } = await Session.create({ title: 'Two edits' })
            await Approval.check({ sessionId, messageId: 'm', toolCallId: 't1', toolName: 'write_to_file', input: { path: target } })
            await writeFile(target, 'v1')
            await Approval.check({ sessionId, messageId: 'm', toolCallId: 't2', toolName: 'write_to_file', input: { path: target } })
            await writeFile(target, 'v2')

            await Session.rollbackTool({ sessionId, toolCallId: 't2' })
            expect(await readFile(target, 'utf8')).toBe('v1')

            await rm(target, { force: true })
        })
    })

    test('回退到不存在的消息时，先报错，不先动文件', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'allow' } })
            const target = await tempFile('agent-invalid-rollback', 'before')

            const { sessionId } = await Session.create({ title: 'Invalid rollback' })
            const added = await History.add({ sessionId, message: AgentCore.history.user({ content: '改一个文件' }) })
            await History.save(sessionId)
            await Approval.check({ sessionId, messageId: added.message.id, toolCallId: 'call-invalid', toolName: 'write_to_file', input: { path: target } })
            await writeFile(target, 'after')

            await expect(Session.rollback({ sessionId, messageId: 'missing-message', files: true })).rejects.toThrow(/not found/i)
            expect(await readFile(target, 'utf8')).toBe('after')

            await rm(target, { force: true })
        })
    })
})

describe('权限规则的拒绝动作', () => {
    test('deny 优先于自动批准，不会留下等待中的审批', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'allow', execute_command: 'deny' } })
            const { sessionId } = await Session.create({ title: 'Deny wins' })
            await Session.saveSettings({ sessionId, autoApprove: { command: true } })

            const allowed = await Approval.check({ sessionId, toolCallId: 'deny-1', toolName: 'execute_command', input: { command: 'rm -rf build' } })
            expect(allowed).toBe(false)
            expect(Approval.pending(sessionId)).toEqual([])
        })
    })

    test('对象规则按最后一条命中的模式决定', async () => {
        await withHome(async () => {
            await Config.set({
                providers: [{ name: 'local', models: ['model'] }],
                permission: { execute_command: { '*': 'ask', 'make *': 'allow', 'make deploy*': 'deny' } },
            })
            const { sessionId } = await Session.create({ title: 'Last match' })

            expect(await Approval.check({ sessionId, toolCallId: 'make-build', toolName: 'execute_command', input: { command: 'make build' } })).toBe(true)
            expect(await Approval.check({ sessionId, toolCallId: 'make-deploy', toolName: 'execute_command', input: { command: 'make deploy' } })).toBe(false)
        })
    })

    test('工具自己的 allow 可以覆盖全局 deny', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'deny', execute_command: 'allow' } })
            const { sessionId } = await Session.create({ title: 'Override' })
            expect(await Approval.check({ sessionId, toolCallId: 'shell-ok', toolName: 'execute_command', input: { command: 'ls' } })).toBe(true)
        })
    })

    test('全局 deny 不拦记清单和结束循环', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'deny' } })
            const { sessionId } = await Session.create({ title: 'Internal tools' })

            expect(await Approval.check({ sessionId, toolCallId: 'todo-1', toolName: 'update_todo_list', input: { todos: '' } })).toBe(true)
            expect(await Approval.check({ sessionId, toolCallId: 'shell-deny', toolName: 'execute_command', input: { command: 'ls' } })).toBe(false)
        })
    })

    test('认不出的规则值按询问处理，不会自动放行', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { execute_command: 'maybe' } })
            const { sessionId } = await Session.create({ title: 'Unknown action' })

            const task = Approval.check({ sessionId, toolCallId: 'unknown-1', toolName: 'execute_command', input: { command: 'ls' } })
            await Bun.sleep(0)
            expect(Approval.pending(sessionId)).toHaveLength(1)
            await Approval.decide({ sessionId, toolCallId: 'unknown-1', decision: 'deny' })
            expect(await task).toBe(false)
        })
    })
})

describe('重复调用的刹车', () => {
    test('同一个调用连续三次会停下来问，答过之后重新计数', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'allow' } })
            const { sessionId } = await Session.create({ title: 'Loop guard' })
            await Session.saveSettings({ sessionId, autoApprove: { read: true } })

            const call = id => Approval.check({ sessionId, toolCallId: id, toolName: 'read_file', input: { path: 'a.txt' } })
            expect(await call('a1')).toBe(true)
            expect(await call('a2')).toBe(true)

            const third = call('a3')
            await Bun.sleep(0)
            expect(Approval.pending(sessionId)).toHaveLength(1)
            await Approval.decide({ sessionId, toolCallId: 'a3', decision: 'allow-once' })
            expect(await third).toBe(true)
            expect(await Approval.check({ sessionId, toolCallId: 'a4', toolName: 'read_file', input: { path: 'a.txt' } })).toBe(true)
        })
    })

    test('不同参数不累计', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'allow' } })
            const { sessionId } = await Session.create({ title: 'Different inputs' })
            await Session.saveSettings({ sessionId, autoApprove: { read: true } })

            for (const path of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) {
                expect(await Approval.check({ sessionId, toolCallId: path, toolName: 'read_file', input: { path } })).toBe(true)
            }
            expect(Approval.pending(sessionId)).toEqual([])
        })
    })

    test('deny 仍然优先于重复刹车', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'allow', read_file: 'deny' } })
            const { sessionId } = await Session.create({ title: 'Deny first' })

            for (const id of ['d1', 'd2', 'd3']) {
                expect(await Approval.check({ sessionId, toolCallId: id, toolName: 'read_file', input: { path: 'a.txt' } })).toBe(false)
            }
            expect(Approval.pending(sessionId)).toEqual([])
        })
    })
})

describe('敏感文件', () => {
    test('读文件工具内置保护，不依赖配置', async () => {
        await withHome(async () => {
            await Config.set({ permission: { '*': 'allow' } })
            await expect(File.read_file.execute({ path: 'D:/app/.env' }, {})).rejects.toThrow(/protected file/i)
            await expect(File.read_file.execute({ path: 'C:/Users/me/.agent/config.json' }, {})).rejects.toThrow(/protected file/i)
            expect(File.sensitive('D:/app/src/a.js')).toBe(false)
        })
    })
})

describe('请求参数的类型检查', () => {
    test('提交的不是对象时按用户填错处理', async () => {
        await withHome(async () => {
            for (const body of ['not-an-object', 42, []]) {
                await expect(Config.set(body)).rejects.toThrow(/must be an object/i)
                await Config.set(body).catch(error => expect(error.status).toBe(400))
            }
        })
    })
})
