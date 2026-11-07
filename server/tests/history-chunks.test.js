import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import History from '../features/history.js'
import search from '../tools/history.js'
import Path from '../utils/path.js'

const homes = []
const withHome = async callback => {
    const root = await mkdtemp(join(tmpdir(), 'agent-history-chunks-'))
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

describe('会话历史分块', () => {
    test('只把活跃窗口写进 history.json，旧消息进入只读分块', async () => {
        await withHome(async root => {
            const session = await History.create({ title: '长历史', cwd: root, settings: { reasoning: 'auto' } })
            for (let index = 0; index < 900; index += 1) await History.add({ sessionId: session.id, message: message(index) })
            await History.save(session.id)

            const active = JSON.parse(await readFile(Path.history(session.id), 'utf8'))
            expect(active.messages.length).toBeLessThanOrEqual(400)
            const files = await readdir(Path.historyArchives(session.id))
            expect(files.length).toBeGreaterThan(0)
            expect(History.get({ sessionId: session.id })).toHaveLength(900)

            History.clear()
            const loaded = await History.load(session.id)
            expect(loaded.history.messages).toHaveLength(900)
            expect(loaded.history.messages[0].message.id).toBe('m0')
            expect(loaded.history.activeStart).toBeGreaterThan(0)

            const page = await History.page({ sessionId: session.id, before: 300, limit: 50 })
            expect(page).toMatchObject({ start: 250, end: 300, total: 900, hasMore: true })
            expect(page.messages[0].id).toBe('m250')
            expect(page.messages).toHaveLength(50)

            const last = await History.page({ sessionId: session.id, limit: 20 })
            expect(last.end).toBe(900)
            expect(last.messages[0].id).toBe('m880')

            const outline = await History.outline(session.id)
            expect(outline.totalMessages).toBe(900)
            expect(outline.turns.length).toBeGreaterThan(0)
            expect(outline.turns[0]).toMatchObject({ index: 0, role: 'user', prompt: '第 0 条' })

            const found = await search.execute({ query: '第 0 条' }, { sessionId: session.id })
            expect(found.matches.length).toBeGreaterThan(0)
        })
    })

    test('回退跨过分块边界时重建分块，不留下已删除消息', async () => {
        await withHome(async root => {
            const session = await History.create({ title: '回退', cwd: root, settings: { reasoning: 'auto' } })
            for (let index = 0; index < 900; index += 1) await History.add({ sessionId: session.id, message: message(index) })
            await History.save(session.id)
            const target = History.get({ sessionId: session.id })[100].messageId
            await History.rollback({ sessionId: session.id, messageId: target })
            await History.save(session.id)

            History.clear()
            const loaded = await History.load(session.id)
            expect(loaded.history.messages).toHaveLength(100)
            expect(loaded.history.messages.at(-1).message.id).toBe('m99')
            expect(loaded.history.archives).toEqual([])
        })
    })

    test('分块优先从上下文压缩点切开，活跃历史从摘要开始', async () => {
        await withHome(async root => {
            const session = await History.create({ title: '压缩切块', cwd: root, settings: { reasoning: 'auto' } })
            for (let index = 0; index < 1000; index += 1) {
                const item = message(index)
                if (index === 600) item.compact = true
                await History.add({ sessionId: session.id, message: item })
            }
            await History.save(session.id)

            const index = JSON.parse(await readFile(Path.historyIndex(session.id), 'utf8'))
            const active = JSON.parse(await readFile(Path.history(session.id), 'utf8'))
            expect(index.format).toBe(2)
            expect(index.archives).toHaveLength(1)
            expect(index.archives[0].count).toBe(600)
            expect(active.messages[0].message.compact).toBe(true)
            expect(active.messages).toHaveLength(400)
        })
    })

    test('大纲宽度按原文长度算，并包含结束工具的最终输出', async () => {        await withHome(async root => {
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
