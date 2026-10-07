/*
 * 回退与忽略规则测试：工具级回退、消息级回退、内置规则的安全默认。
 *
 * 回退是这套东西里最容易出错的地方——它同时改历史、改磁盘文件、还留着撤销栈，
 * 三者之间不一致就会留下"对话退回去了但文件没退"这种状态，所以单独一个文件盯住它。
 * 每个测试在自己的临时数据目录里跑，互不影响。
 * 运行：cd server && bun test
 */
import { describe, expect, test } from 'bun:test'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import Agent from '@kernel4632/agent-core'

import Approval from '../features/approval.js'
import Config from '../commands/config.js'
import History from '../features/history.js'
import Ignore from '../features/ignore.js'
import Session from '../commands/session.js'

// 每个测试使用独立目录和干净的内存数据，避免测试之间互相影响。
const withHome = async callback => {
    const root = join(tmpdir(), `agent-rollback-${crypto.randomUUID()}`)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    const Store = (await import('../store.js')).default
    Store.config && Object.keys(Store.config).forEach(key => delete Store.config[key])
    Store.agents.clear()
    Store.sessions.clear()
    Store.snapshots.clear()
    Store.approvals.clear()
    try {
        return await callback(root)
    } finally {
        if (previousHome === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previousHome
        await rm(root, { recursive: true, force: true })
    }
}

// 造一个临时文件，返回它的绝对路径；测试结束时由调用方删掉。
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
            const added = await History.add({ sessionId, message: Agent.history.user({ content: '改两个文件' }) })
            await History.save({ sessionId })
            const messageId = added.message.id

            // 同一轮里的两次工具调用，各自记一份快照。
            await Approval.check({ sessionId, messageId, toolCallId: 'call-a', toolName: 'file_write', input: { path: first } })
            await writeFile(first, 'a1')
            await Approval.check({ sessionId, messageId, toolCallId: 'call-b', toolName: 'file_write', input: { path: second } })
            await writeFile(second, 'b1')

            // 两次调用都记下了，界面据此列出可回退的点。
            expect((await Session.toolChanges({ sessionId })).map(entry => entry.toolCallId)).toEqual(['call-a', 'call-b'])

            // 只退第二次：第二个文件回到 b0，第一个保持在 a1。
            // 这正是工具级回退的意义——一个工具把文件改坏了，别的工具的成果不用一起丢。
            const result = await Session.rollbackTool({ sessionId, toolCallId: 'call-b' })
            expect(result.restored).toContain(resolve(second))
            expect(await readFile(second, 'utf8')).toBe('b0')
            expect(await readFile(first, 'utf8')).toBe('a1')
            expect((await Session.toolChanges({ sessionId })).map(entry => entry.toolCallId)).toEqual(['call-a'])

            // 撤销回退把它放回来，文件也跟着回去。
            await Session.redo({ sessionId })
            expect(await readFile(second, 'utf8')).toBe('b1')

            // files=false 时只去掉记录，磁盘上的文件不动。
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
            // 用户可能拿着旧界面上的 id 来退，找不到时要说清"这次调用不存在"，不能静默成功。
            await expect(Session.rollbackTool({ sessionId, toolCallId: 'never-happened' })).rejects.toThrow(/not found/i)
        })
    })

    test('工具级回退不改变对话历史', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'allow' } })
            const target = await tempFile('agent-keep-history', 'before')

            const { sessionId } = await Session.create({ title: 'History stays' })
            const added = await History.add({ sessionId, message: Agent.history.user({ content: '改一个文件' }) })
            await History.save({ sessionId })

            await Approval.check({ sessionId, messageId: added.message.id, toolCallId: 'call-x', toolName: 'file_write', input: { path: target } })
            await writeFile(target, 'after')

            await Session.rollbackTool({ sessionId, toolCallId: 'call-x' })
            // 这是它和消息级回退的关键区别：对话一条都没少，只有文件回去了。
            expect((await Session.read({ sessionId })).history).toHaveLength(1)
            expect(await readFile(target, 'utf8')).toBe('before')

            await rm(target, { force: true })
        })
    })
})

describe('忽略规则的安全默认', () => {
    test('还没调用 load 时，内置规则就已经生效', async () => {
        // 内置规则必须在模块加载时就生效，不能等 load()。
        // 否则任何忘了先 load() 的调用方都会静默放行全部文件，连 .env 也一起漏掉。
        expect(Ignore.blocks({ toolName: 'file_read', input: { path: 'D:/app/.env' } })).toBe(true)
        // 被拦住时要说清是哪一条规则挡下的，用户和界面都靠它判断。
        expect(Ignore.blockedBy({ toolName: 'file_read', input: { path: 'D:/app/.env' } })).toBe('.env')
        expect(Ignore.blockedBy({ toolName: 'file_read', input: { path: 'D:/app/src/a.js' } })).toBe(null)
    })

    test('agent 自己的数据目录也在保护范围内', async () => {
        // 数据目录里有 API Key 和全部会话，工具不该能读到它。
        expect(Ignore.blocks({ toolName: 'file_read', input: { path: 'C:/Users/me/.agent/config.json' } })).toBe(true)
    })
})

describe('请求参数的类型检查', () => {
    test('提交的不是对象时按用户填错处理', async () => {
        await withHome(async () => {
            // 必须是 400 而不是 500：这是用户填错，不是后端坏了。
            for (const body of ['not-an-object', 42, []]) {
                await expect(Config.set(body)).rejects.toThrow(/must be an object/i)
                // 状态码要带上，入口才能发回 400。
                await Config.set(body).catch(error => expect(error.status).toBe(400))
            }
        })
    })
})
