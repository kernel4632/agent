/*
 * 回退与忽略规则测试：工具级回退、消息级回退、内置规则的安全默认。
 *
 * 回退是这套东西里最容易出错的地方——它同时改历史、改磁盘文件、还留着撤销栈，
 * 三者之间不一致就会留下"对话退回去了但文件没退"这种状态，所以单独一个文件盯住它。
 * 每个测试在自己的临时数据目录里跑，互不影响。
 * 运行：cd server && bun test
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import Agent from '@kernel4632/agent-core'

import Approval from '../safety/approval.js'
import Config from '../config/config.js'
import History from '../session/history.js'
import Ignore from '../safety/ignore.js'
import Session from '../session/session.js'
import Snapshot from '../session/snapshot.js'

// 每个测试使用独立目录和干净的内存数据，避免测试之间互相影响。
const withHome = async callback => {
    const root = join(tmpdir(), `agent-rollback-${crypto.randomUUID()}`)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    const Store = (await import('../store.js')).default
    Store.config && Object.keys(Store.config).forEach(key => delete Store.config[key])
    Store.agents.clear()
    History.clear()
    Store.snapshots.clear()
    Store.approvals.clear()
    Store.settings.clear()
    Store.recentCalls.clear()
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

// 造一个临时工作区，并在测试期间把进程的工作目录切过去；结束时恢复。
const withWorkspace = async callback => {
    const root = join(tmpdir(), `agent-workspace-${crypto.randomUUID()}`)
    await mkdir(root, { recursive: true })
    const previous = process.cwd()
    process.chdir(root)
    try {
        return await callback(root)
    } finally {
        process.chdir(previous)
        await rm(root, { recursive: true, force: true })
    }
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
            await Approval.check({ sessionId, messageId, toolCallId: 'call-a', toolName: 'write_to_file', input: { path: first } })
            await writeFile(first, 'a1')
            await Approval.check({ sessionId, messageId, toolCallId: 'call-b', toolName: 'write_to_file', input: { path: second } })
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

            await Approval.check({ sessionId, messageId: added.message.id, toolCallId: 'call-x', toolName: 'write_to_file', input: { path: target } })
            await writeFile(target, 'after')

            await Session.rollbackTool({ sessionId, toolCallId: 'call-x' })
            // 这是它和消息级回退的关键区别：对话一条都没少，只有文件回去了。
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

            // 回退第二次：文件要回到第一次改完的 v1，而不是停在 v2。
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
            const added = await History.add({ sessionId, message: Agent.history.user({ content: '改一个文件' }) })
            await History.save({ sessionId })
            await Approval.check({ sessionId, messageId: added.message.id, toolCallId: 'call-invalid', toolName: 'write_to_file', input: { path: target } })
            await writeFile(target, 'after')

            // 文件恢复要拿到"保留哪些消息"的名单；名单都取不到时不能先改文件再报 404。
            await expect(Session.rollback({ sessionId, messageId: 'missing-message', files: true })).rejects.toThrow(/not found/i)
            expect(await readFile(target, 'utf8')).toBe('after')

            await rm(target, { force: true })
        })
    })
})

describe('权限规则的拒绝动作', () => {
    test('deny 优先于自动批准，不会留下等待中的审批', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'allow', shell: 'deny' } })
            const { sessionId } = await Session.create({ title: 'Deny wins' })
            // 命令类全开也不该绕过一条明确的拒绝。
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
                permission: { shell: { '*': 'ask', 'git *': 'allow', 'git push *': 'deny' } },
            })
            const { sessionId } = await Session.create({ title: 'Last match' })

            expect(await Approval.check({ sessionId, toolCallId: 'git-status', toolName: 'execute_command', input: { command: 'git status' } })).toBe(true)
            expect(await Approval.check({ sessionId, toolCallId: 'git-push', toolName: 'execute_command', input: { command: 'git push origin main' } })).toBe(false)
        })
    })

    test('工具自己的 allow 可以覆盖全局 deny', async () => {
        await withHome(async () => {
            await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'deny', shell: 'allow' } })
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
            await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { shell: 'maybe' } })
            const { sessionId } = await Session.create({ title: 'Unknown action' })

            const task = Approval.check({ sessionId, toolCallId: 'unknown-1', toolName: 'execute_command', input: { command: 'ls' } })
            await Bun.sleep(0)
            // 写错一个词不能变成 allow；它应该老老实实停下来问。
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

            // 第三次不再替用户直接放行，而是停下来问一次。
            const third = call('a3')
            await Bun.sleep(0)
            expect(Approval.pending(sessionId)).toHaveLength(1)
            await Approval.decide({ sessionId, toolCallId: 'a3', decision: 'allow-once' })
            expect(await third).toBe(true)

            // 用户刚确认过，计数从头开始，下一次仍然直接放行。
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
            await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'allow', file_read: 'deny' } })
            const { sessionId } = await Session.create({ title: 'Deny first' })

            for (const id of ['d1', 'd2', 'd3']) {
                expect(await Approval.check({ sessionId, toolCallId: id, toolName: 'read_file', input: { path: 'a.txt' } })).toBe(false)
            }
            expect(Approval.pending(sessionId)).toEqual([])
        })
    })
})

describe('shell 改动的快照', () => {
    test('shell 改了、删了、加了文件都能回退，也能撤销回退', async () => {
        await withHome(async () => {
            await withWorkspace(async root => {
                await writeFile(join(root, 'a.txt'), 'a0')
                await writeFile(join(root, 'b.txt'), 'b0')
                await writeFile(join(root, 'c.txt'), 'c0')

                await Config.set({
                    providers: [{ name: 'local', models: ['model'] }],
                    permission: { '*': 'allow' },
                    snapshot: { shell: true },
                })
                const { sessionId } = await Session.create({ title: 'Shell snapshot' })

                const started = await Snapshot.beginShell({ sessionId, messageId: 'message-1', toolCallId: 'shell-1' })
                expect(started.skipped).toBe(false)

                // 模拟 shell：改一个、删一个、加一个，c 不动。
                await writeFile(join(root, 'a.txt'), 'a1')
                await rm(join(root, 'b.txt'))
                await writeFile(join(root, 'd.txt'), 'd1')
                const ended = await Snapshot.endShell({ sessionId, toolCallId: 'shell-1' })
                expect(ended.changed).toBe(3)

                const changes = await Session.toolChanges({ sessionId })
                expect(changes.map(entry => entry.toolCallId)).toContain('shell-1')

                await Session.rollbackTool({ sessionId, toolCallId: 'shell-1' })
                expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('a0')
                expect(await readFile(join(root, 'b.txt'), 'utf8')).toBe('b0')
                expect(await Bun.file(join(root, 'd.txt')).exists()).toBe(false)
                expect(await readFile(join(root, 'c.txt'), 'utf8')).toBe('c0')

                // 撤销回退：文件和命令跑完时一样。
                await Session.redo({ sessionId })
                expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('a1')
                expect(await readFile(join(root, 'd.txt'), 'utf8')).toBe('d1')
                expect(await Bun.file(join(root, 'b.txt')).exists()).toBe(false)
            })
        })
    })

    test('没打开 snapshot.shell 时不为 shell 建检查点', async () => {
        await withHome(async () => {
            await withWorkspace(async root => {
                await writeFile(join(root, 'a.txt'), 'a0')
                await Config.set({
                    providers: [{ name: 'local', models: ['model'] }],
                    permission: { '*': 'allow' },
                    snapshot: { shell: false },
                })
                const { sessionId } = await Session.create({ title: 'Shell off' })

                expect((await Snapshot.beginShell({ sessionId, messageId: 'm', toolCallId: 'shell-off' })).skipped).toBe(true)
                await writeFile(join(root, 'a.txt'), 'a1')
                expect((await Snapshot.endShell({ sessionId, toolCallId: 'shell-off' })).skipped).toBe(true)
                expect(await Session.toolChanges({ sessionId })).toEqual([])
            })
        })
    })

    test('shell 没改任何文件时不建检查点', async () => {
        await withHome(async () => {
            await withWorkspace(async root => {
                await writeFile(join(root, 'a.txt'), 'a0')
                await Config.set({ providers: [{ name: 'local', models: ['model'] }], permission: { '*': 'allow' }, snapshot: { shell: true } })
                const { sessionId } = await Session.create({ title: 'Shell no change' })

                await Snapshot.beginShell({ sessionId, messageId: 'm', toolCallId: 'shell-quiet' })
                const ended = await Snapshot.endShell({ sessionId, toolCallId: 'shell-quiet' })
                expect(ended.changed).toBe(0)
                expect(await Session.toolChanges({ sessionId })).toEqual([])
            })
        })
    })

    test('文件数超过上限时整次快照跳过，不影响命令本身', async () => {
        await withHome(async () => {
            await withWorkspace(async root => {
                await writeFile(join(root, 'a.txt'), 'a0')
                await writeFile(join(root, 'b.txt'), 'b0')
                await Config.set({
                    providers: [{ name: 'local', models: ['model'] }],
                    permission: { '*': 'allow' },
                    snapshot: { shell: true, maxFiles: 1 },
                })
                const { sessionId } = await Session.create({ title: 'Shell too big' })

                const started = await Snapshot.beginShell({ sessionId, messageId: 'm', toolCallId: 'shell-big' })
                expect(started.skipped).toBe(true)
                expect(await Session.toolChanges({ sessionId })).toEqual([])
            })
        })
    })
})

describe('忽略规则的安全默认', () => {
    test('还没调用 load 时，内置规则就已经生效', async () => {
        // 内置规则必须在模块加载时就生效，不能等 load()。
        // 否则任何忘了先 load() 的调用方都会静默放行全部文件，连 .env 也一起漏掉。
        expect(Ignore.blocks({ toolName: 'read_file', input: { path: 'D:/app/.env' } })).toBe(true)
        // 被拦住时要说清是哪一条规则挡下的，用户和界面都靠它判断。
        expect(Ignore.blockedBy({ toolName: 'read_file', input: { path: 'D:/app/.env' } })).toBe('.env')
        expect(Ignore.blockedBy({ toolName: 'read_file', input: { path: 'D:/app/src/a.js' } })).toBe(null)
    })

    test('agent 自己的数据目录也在保护范围内', async () => {
        // 数据目录里有 API Key 和全部会话，工具不该能读到它。
        expect(Ignore.blocks({ toolName: 'read_file', input: { path: 'C:/Users/me/.agent/config.json' } })).toBe(true)
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
