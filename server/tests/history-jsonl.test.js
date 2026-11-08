import { afterEach, describe, expect, test } from 'bun:test'
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import History from '../features/history.js'
import Path from '../utils/path.js'

const homes = []
const withHome = async callback => {
    const root = await mkdtemp(join(tmpdir(), 'agent-history-log-'))
    homes.push(root)
    const previous = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    Path.lock(root)
    History.clear()
    try {
        return await callback(root)
    } finally {
        History.clear()
        Path.unlock()
        if (previous === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previous
    }
}

afterEach(async () => {
    await Promise.all(homes.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const message = index => ({ id: `m${index}`, role: index % 2 ? 'assistant' : 'user', content: [{ type: 'text', text: `第 ${index} 条` }] })

const lines = async file => (await readFile(file, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line))

describe('会话历史 JSONL', () => {
    test('正常保存只追加，不重写已有历史', async () => {
        await withHome(async root => {
            const session = await History.create({ title: '追加', cwd: root, settings: { reasoning: 'auto' } })
            for (let index = 0; index < 900; index += 1) await History.add({ sessionId: session.id, message: message(index) })
            await History.save(session.id)

            const log = Path.historyLog(session.id)
            const first = await readFile(log, 'utf8')
            expect(await lines(log)).toHaveLength(900)
            expect(first.endsWith('\n')).toBe(true)
            await expect(access(Path.history(session.id))).rejects.toThrow()

            await History.add({ sessionId: session.id, message: message(900) })
            await History.save(session.id)
            const second = await readFile(log, 'utf8')
            expect(second.startsWith(first)).toBe(true)
            expect(await lines(log)).toHaveLength(901)
            expect((await stat(log)).size).toBeGreaterThan(Buffer.byteLength(first))

            History.clear()
            const loaded = await History.load(session.id)
            expect(loaded.history.messages).toHaveLength(901)
            expect(loaded.history.messages[0].message.id).toBe('m0')

            const page = await History.pageByOffset({ sessionId: session.id, limit: 20 })
            expect(page.messages).toHaveLength(20)
            expect(page.messages[0].id).toBe('m881')
            expect(page.hasMore).toBe(true)
            expect(page.total).toBe(901)

            const older = await History.pageByOffset({ sessionId: session.id, beforeOffset: page.startOffset, limit: 20 })
            expect(older.messages.at(-1).id).toBe('m880')
        })
    })

    test('回退后重写，删除的消息不会留在 JSONL 里', async () => {
        await withHome(async root => {
            const session = await History.create({ title: '回退', cwd: root, settings: { reasoning: 'auto' } })
            for (let index = 0; index < 100; index += 1) await History.add({ sessionId: session.id, message: message(index) })
            await History.save(session.id)
            const target = History.get({ sessionId: session.id })[50].messageId
            await History.rollback({ sessionId: session.id, messageId: target })
            await History.save(session.id)

            const log = await lines(Path.historyLog(session.id))
            expect(log).toHaveLength(50)
            expect(log.at(-1).message.id).toBe('m49')

            History.clear()
            const loaded = await History.load(session.id)
            expect(loaded.history.messages).toHaveLength(50)
            expect(loaded.history.redo).toHaveLength(1)
        })
    })

    test('旧 history.json 会迁移到 JSONL，旧文件随后删除', async () => {
        await withHome(async root => {
            const session = await History.create({ title: '迁移', cwd: root, settings: { reasoning: 'auto' } })
            const legacy = { messages: [0, 1, 2].map(index => ({ messageId: `legacy-${index}`, message: message(index) })), redo: [] }
            await Bun.write(Path.history(session.id), JSON.stringify(legacy))
            await rm(Path.historyLog(session.id), { force: true })
            History.clear()

            const loaded = await History.load(session.id)
            expect(loaded.history.messages).toHaveLength(3)
            await History.save(session.id)
            expect(await lines(Path.historyLog(session.id))).toHaveLength(3)
            await expect(access(Path.history(session.id))).rejects.toThrow()
        })
    })

    test('大纲宽度按原文长度算，并包含结束工具的最终输出', async () => {
        await withHome(async root => {
            const session = await History.create({ title: '宽度', cwd: root, settings: { reasoning: 'auto' } })
            await History.add({
                sessionId: session.id,
                message: { id: 'u1', role: 'user', content: [{ type: 'text', text: '第一行\n\n第二行' }] },
            })
            await History.add({
                sessionId: session.id,
                message: {
                    id: 'a1',
                    role: 'assistant',
                    content: [{ type: 'tool-call', toolCallId: 'call-stop', toolName: 'attempt_completion', input: {} }],
                },
            })
            await History.add({
                sessionId: session.id,
                message: {
                    id: 't1',
                    role: 'tool',
                    content: [{ type: 'tool-result', toolCallId: 'call-stop', toolName: 'attempt_completion', output: { type: 'text', value: '最终答案\n\n第二段' } }],
                },
            })
            await History.save(session.id)

            const result = await History.outline(session.id)
            expect(result.turns).toHaveLength(1)
            expect(result.turns[0]).toMatchObject({ id: expect.any(String), role: 'user' })
            expect(result.turns[0].prompt).toBe('第一行 第二行')
            expect(result.turns[0].response).toBe('最终答案 第二段')
            expect(result.turns[0].length).toBe('第一行\n\n第二行'.length + '最终答案\n\n第二段'.length)
        })
    })
})
