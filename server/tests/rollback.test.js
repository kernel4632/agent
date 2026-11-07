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
import Path from '../utils/path.js'
import Agent from '../features/agent.js'
import Settings from '../commands/settings.js'
import History from '../features/history.js'
import Session from '../commands/session.js'
import * as File from '../tools/file.js'
import store from '../store.js'
// 有状态模块在服务入口装配；单独 import 命令时也要走一遍，和启动时是同一条路径。
import '../server.js'

// 每个测试使用独立目录和干净的内存数据。
const withHome = async callback => {
    const root = join(tmpdir(), `agent-rollback-${crypto.randomUUID()}`)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    Path.lock(root)   // 锁定数据目录：晚到的异步收尾不会落到真实 ~/.agent
    Object.keys(store.config).forEach(key => delete store.config[key])
    Agent.runtime().clear()
    History.clear()
    try {
        return await callback(root)
    } finally {
        Path.unlock()
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
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }], permission: { '*': 'allow' } })
            const first = await tempFile('agent-tool-a', 'a0')
            const second = await tempFile('agent-tool-b', 'b0')

            const { sessionId } = await Session.create({ title: 'Tool rollback' })
            const added = await History.add({ sessionId, message: AgentCore.history.user({ content: '改两个文件' }) })
            await History.save(sessionId)
            const messageId = added.message.id

            await Approval.check({ sessionId, messageId, toolCallId: 'call-a', toolName: 'write_file', input: { path: first } })
            await writeFile(first, 'a1')
            await Approval.check({ sessionId, messageId, toolCallId: 'call-b', toolName: 'write_file', input: { path: second } })
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
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }] })
            const { sessionId } = await Session.create({ title: 'No such call' })
            await expect(Session.rollbackTool({ sessionId, toolCallId: 'never-happened' })).rejects.toThrow(/not found/i)
        })
    })

    test('工具级回退不改变对话历史', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }], permission: { '*': 'allow' } })
            const target = await tempFile('agent-keep-history', 'before')

            const { sessionId } = await Session.create({ title: 'History stays' })
            const added = await History.add({ sessionId, message: AgentCore.history.user({ content: '改一个文件' }) })
            await History.save(sessionId)

            await Approval.check({ sessionId, messageId: added.message.id, toolCallId: 'call-x', toolName: 'write_file', input: { path: target } })
            await writeFile(target, 'after')

            await Session.rollbackTool({ sessionId, toolCallId: 'call-x' })
            expect((await Session.read({ sessionId })).history).toHaveLength(1)
            expect(await readFile(target, 'utf8')).toBe('before')

            await rm(target, { force: true })
        })
    })

    test('连续改同一个文件时，回退后一次会恢复成前一次的结果', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }], permission: { '*': 'allow' } })
            const target = await tempFile('agent-twice', 'v0')

            const { sessionId } = await Session.create({ title: 'Two edits' })
            await Approval.check({ sessionId, messageId: 'm', toolCallId: 't1', toolName: 'write_file', input: { path: target } })
            await writeFile(target, 'v1')
            await Approval.check({ sessionId, messageId: 'm', toolCallId: 't2', toolName: 'write_file', input: { path: target } })
            await writeFile(target, 'v2')

            await Session.rollbackTool({ sessionId, toolCallId: 't2' })
            expect(await readFile(target, 'utf8')).toBe('v1')

            await rm(target, { force: true })
        })
    })

    test('回退到不存在的消息时，先报错，不先动文件', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }], permission: { '*': 'allow' } })
            const target = await tempFile('agent-invalid-rollback', 'before')

            const { sessionId } = await Session.create({ title: 'Invalid rollback' })
            const added = await History.add({ sessionId, message: AgentCore.history.user({ content: '改一个文件' }) })
            await History.save(sessionId)
            await Approval.check({ sessionId, messageId: added.message.id, toolCallId: 'call-invalid', toolName: 'write_file', input: { path: target } })
            await writeFile(target, 'after')

            await expect(Session.rollback({ sessionId, messageId: 'missing-message', files: true })).rejects.toThrow(/not found/i)
            expect(await readFile(target, 'utf8')).toBe('after')

            await rm(target, { force: true })
        })
    })
})

describe('助手块回退的粒度', () => {
    // 一次运行按步骤落多条助手消息，工具结果夹在中间；回退单位是“那条消息+它的工具”。
    const seedRun = async () => {
        await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }], permission: { '*': 'allow' } })
        const { sessionId } = await Session.create({ title: 'Assistant block' })
        const add = message => History.add({ sessionId, message })
        const user = await add(AgentCore.history.user({ content: '连着做三步' }))
        const a1 = await add({ id: 'a1', role: 'assistant', content: [{ type: 'text', text: '第一步' }, { type: 'tool-call', toolCallId: 'call-1', toolName: 'write_file', input: { path: 'one.txt', content: '1' } }] })
        const t1 = await add({ id: 't1', role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call-1', toolName: 'write_file', output: { type: 'text', value: 'ok' } }] })
        const a2 = await add({ id: 'a2', role: 'assistant', content: [{ type: 'text', text: '第二步' }, { type: 'tool-call', toolCallId: 'call-2', toolName: 'write_file', input: { path: 'two.txt', content: '2' } }] })
        const t2 = await add({ id: 't2', role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call-2', toolName: 'write_file', output: { type: 'text', value: 'ok' } }] })
        const a3 = await add({ id: 'a3', role: 'assistant', content: [{ type: 'text', text: '完成' }] })
        await History.save(sessionId)
        return { sessionId, user, a1, t1, a2, t2, a3 }
    }

    test('回退中间的助手消息只撤它自己和它附带的工具结果', async () => {
        await withHome(async () => {
            const { sessionId, user, a2 } = await seedRun()
            const preview = await Session.rollbackPreview({ sessionId, messageId: a2.messageId })
            expect(preview.messages).toBe(2)                               // a2 和它后面的 a3，工具结果不算
            expect(preview.toolCalls).toEqual(['call-2'])

            await Session.rollback({ sessionId, messageId: a2.messageId, files: false })
            const ids = (await Session.read({ sessionId })).history.map(message => message.id)
            expect(ids).toEqual([user.message.id, 'a1', 't1'])

            // 撤销回退后原样放回末尾，顺序不变。
            await Session.redo({ sessionId, files: false })
            expect((await Session.read({ sessionId })).history.map(message => message.id))
                .toEqual([user.message.id, 'a1', 't1', 'a2', 't2', 'a3'])
        })
    })

    test('回退最后一条助手消息只撤它自己', async () => {
        await withHome(async () => {
            const { sessionId, a3 } = await seedRun()
            const preview = await Session.rollbackPreview({ sessionId, messageId: a3.messageId })
            expect(preview.messages).toBe(1)
            expect(preview.toolCalls).toEqual([])

            await Session.rollback({ sessionId, messageId: a3.messageId, files: false })
            const ids = (await Session.read({ sessionId })).history.map(message => message.id)
            expect(ids).toHaveLength(5)
            expect(ids).not.toContain('a3')
        })
    })

    test('回退用户消息仍然是这条和之后的全部消失', async () => {
        await withHome(async () => {
            const { sessionId, user } = await seedRun()
            const preview = await Session.rollbackPreview({ sessionId, messageId: user.messageId })
            expect(preview.messages).toBe(4)                               // u、a1、a2、a3
            expect(preview.toolCalls).toEqual(['call-1', 'call-2'])

            await Session.rollback({ sessionId, messageId: user.messageId, files: false })
            expect((await Session.read({ sessionId })).history).toHaveLength(0)
        })
    })

    test('回退带工具的助手消息会把它的文件改动一起恢复', async () => {
        await withHome(async () => {
            const target = await tempFile('agent-block-file', 'before')
            const { sessionId, a2 } = await seedRun()
            await File.snapshot({ sessionId, messageId: a2.message.id, toolCallId: 'call-2', toolName: 'write_file', input: { path: target, content: '' } })
            await writeFile(target, 'after')

            const result = await Session.rollback({ sessionId, messageId: a2.messageId })
            expect(result.restored).toContain(resolve(target))
            expect(await readFile(target, 'utf8')).toBe('before')

            // 撤销回退把文件放回改动后的样子。
            await Session.redo({ sessionId })
            expect(await readFile(target, 'utf8')).toBe('after')

            await rm(target, { force: true })
        })
    })

    test('没有调用 id 的旧快照按消息归属兜底，不会被误恢复', async () => {
        await withHome(async () => {
            const target = await tempFile('agent-legacy-file', 'before')
            const { sessionId, user, a2 } = await seedRun()
            // 旧版快照只记了触发运行的那条用户消息，没有真实调用 id。
            await File.snapshot({ sessionId, messageId: user.message.id, toolCallId: '', toolName: 'write_file', input: { path: target, content: '' } })
            await writeFile(target, 'after')

            const result = await Session.rollback({ sessionId, messageId: a2.messageId })
            expect(result.restored).toEqual([])
            expect(await readFile(target, 'utf8')).toBe('after')

            await rm(target, { force: true })
        })
    })
})

describe('权限规则的拒绝动作', () => {
    test('deny 直接拒绝，不会留下等待中的审批', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }], permission: { '*': 'allow', execute_command: 'deny' } })
            const { sessionId } = await Session.create({ title: 'Deny wins' })

            const allowed = await Approval.check({ sessionId, toolCallId: 'deny-1', toolName: 'execute_command', input: { command: 'rm -rf build' } })
            expect(allowed).toBe(false)
            expect(Approval.pending(sessionId)).toEqual([])
        })
    })

    test('对象规则按最后一条命中的模式决定', async () => {
        await withHome(async () => {
            await Settings.set({
                providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }],
                permission: { execute_command: { '*': 'ask', 'make *': 'allow', 'make deploy*': 'deny' } },
            })
            const { sessionId } = await Session.create({ title: 'Last match' })

            expect(await Approval.check({ sessionId, toolCallId: 'make-build', toolName: 'execute_command', input: { command: 'make build' } })).toBe(true)
            expect(await Approval.check({ sessionId, toolCallId: 'make-deploy', toolName: 'execute_command', input: { command: 'make deploy' } })).toBe(false)
        })
    })

    test('工具自己的 allow 可以覆盖全局 deny', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }], permission: { '*': 'deny', execute_command: 'allow' } })
            const { sessionId } = await Session.create({ title: 'Override' })
            expect(await Approval.check({ sessionId, toolCallId: 'shell-ok', toolName: 'execute_command', input: { command: 'ls' } })).toBe(true)
        })
    })

    test('全局 deny 不拦记清单和结束循环', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }], permission: { '*': 'deny' } })
            const { sessionId } = await Session.create({ title: 'Internal tools' })

            expect(await Approval.check({ sessionId, toolCallId: 'todo-1', toolName: 'update_todo_list', input: { todos: '' } })).toBe(true)
            expect(await Approval.check({ sessionId, toolCallId: 'shell-deny', toolName: 'execute_command', input: { command: 'ls' } })).toBe(false)
        })
    })

    test('认不出的规则值按询问处理，不会自动放行', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }], permission: { execute_command: 'maybe' } })
            const { sessionId } = await Session.create({ title: 'Unknown action' })

            const task = Approval.check({ sessionId, toolCallId: 'unknown-1', toolName: 'execute_command', input: { command: 'ls' } })
            await Bun.sleep(0)
            expect(Approval.pending(sessionId)).toHaveLength(1)
            await Approval.decide({ sessionId, toolCallId: 'unknown-1', decision: 'deny' })
            expect(await task).toBe(false)
        })
    })
})

describe('允许规则直接放行', () => {
    test('同一个调用连续出现也不再询问', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }], permission: { '*': 'allow' } })
            const { sessionId } = await Session.create({ title: 'Allow repeats' })

            const call = id => Approval.check({ sessionId, toolCallId: id, toolName: 'read_file', input: { path: 'a.txt' } })
            for (const id of ['a1', 'a2', 'a3', 'a4', 'a5']) expect(await call(id)).toBe(true)
            expect(Approval.pending(sessionId)).toEqual([])
        })
    })

    test('对象规则的星号是默认允许，换行和空参数也放行，更具体的拒绝仍然生效', async () => {
        await withHome(async () => {
            await Settings.set({
                providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }],
                permission: { execute_command: { '*': 'allow', 'rm *': 'deny' } },
            })
            const { sessionId } = await Session.create({ title: 'Star default' })
            const run = (id, command) => Approval.check({ sessionId, toolCallId: id, toolName: 'execute_command', input: { command } })

            expect(await run('newline', 'cd /tmp\nls')).toBe(true)
            expect(await run('empty', '')).toBe(true)
            expect(await run('rm', 'rm -rf build')).toBe(false)
            expect(Approval.pending(sessionId)).toEqual([])
        })
    })

    test('始终允许的命令前缀跨过路径斜杠', async () => {
        await withHome(async () => {
            await Settings.set({
                providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }],
                permission: { execute_command: { '*': 'ask', 'cd /tmp*': 'allow' } },
            })
            const { sessionId } = await Session.create({ title: 'Prefix slash' })

            expect(await Approval.check({
                sessionId,
                toolCallId: 'cd-sub',
                toolName: 'execute_command',
                input: { command: 'cd /tmp/qslrun && echo hi' },
            })).toBe(true)

            const other = Approval.check({ sessionId, toolCallId: 'ls', toolName: 'execute_command', input: { command: 'ls' } })
            await Bun.sleep(0)
            expect(Approval.pending(sessionId)).toHaveLength(1)
            await Approval.decide({ sessionId, toolCallId: 'ls', decision: 'deny' })
            expect(await other).toBe(false)
        })
    })

    test('全部批准盖过工具默认询问，多行脚本不再弹窗，明确拒绝仍然生效', async () => {
        await withHome(async () => {
            await Settings.set({
                providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }],
                permission: { '*': 'allow', execute_command: { '*': 'ask', 'rm *': 'deny', 'ls*': 'allow' } },
            })
            const { sessionId } = await Session.create({ title: 'Allow all multiline' })
            const run = (id, command) => Approval.check({ sessionId, toolCallId: id, toolName: 'execute_command', input: { command } })
            const script = "echo \"第一行\"\necho \"第二行\"\necho \"多行命令测试通过\""
            const heredoc = "cd /home/proj && python3 - <<'PY'\nimport io\np='/tmp/a'\nprint(1)\nPY"

            expect(await run('lines', script)).toBe(true)
            expect(await run('heredoc', heredoc)).toBe(true)
            expect(await run('rm', 'rm -rf build')).toBe(false)
            expect(Approval.pending(sessionId)).toEqual([])
        })
    })

    test('允许前缀能盖住带换行和斜杠的整段脚本', async () => {
        await withHome(async () => {
            await Settings.set({
                providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }],
                permission: { '*': 'ask', execute_command: { '*': 'ask', 'cd /home/proj*': 'allow' } },
            })
            const { sessionId } = await Session.create({ title: 'Prefix multiline' })
            const command = "cd /home/proj && python3 - <<'PY'\nimport io\np='/tmp/a'\nprint(1)\nPY"

            expect(await Approval.check({
                sessionId,
                toolCallId: 'heredoc',
                toolName: 'execute_command',
                input: { command },
            })).toBe(true)
            expect(Approval.pending(sessionId)).toEqual([])
        })
    })

    test('不同参数不累计', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }], permission: { '*': 'allow' } })
            const { sessionId } = await Session.create({ title: 'Different inputs' })

            for (const path of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) {
                expect(await Approval.check({ sessionId, toolCallId: path, toolName: 'read_file', input: { path } })).toBe(true)
            }
            expect(Approval.pending(sessionId)).toEqual([])
        })
    })

    test('deny 仍然直接拒绝，不会改成询问', async () => {
        await withHome(async () => {
            await Settings.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }], permission: { '*': 'allow', read_file: 'deny' } })
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
            await Settings.set({ permission: { '*': 'allow' } })
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
                await expect(Settings.set(body)).rejects.toThrow(/must be an object/i)
                await Settings.set(body).catch(error => expect(error.status).toBe(400))
            }
        })
    })
})
