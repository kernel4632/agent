import { afterEach, describe, expect, test } from 'bun:test'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import History from '../features/history.js'
import Path from '../utils/path.js'

const homes = []
const withHome = async callback => {
    const root = await mkdtemp(join(tmpdir(), 'agent-history-segments-'))
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

const text = value => [{ type: 'text', text: value }]
const user = value => ({ role: 'user', content: text(value) })
const assistant = value => ({ role: 'assistant', content: text(value) })
const compact = value => ({ role: 'user', compact: true, content: value })
const lines = async file => (await readFile(file, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line))

async function append(History, sessionId, messages) {
    for (const message of messages) await History.add({ sessionId, message })
    await History.save(sessionId)
}

describe('会话历史按 compact 分段', () => {
    test('保存后生成 manifest、封存段和当前段，加载顺序不变', async () => {
        await withHome(async root => {
            const session = await History.create({ title: '分段', cwd: root, settings: { reasoning: 'auto' } })
            await append(History, session.id, [
                user('第一段问题'),
                assistant('第一段回答'),
                compact('## 第一次压缩\n摘要一'),
                user('第二段问题'),
                assistant('第二段回答'),
                compact('## 第二次压缩\n摘要二'),
                user('当前问题'),
                assistant('当前回答'),
            ])

            await expect(access(Path.historyLog(session.id))).rejects.toThrow()
            const manifest = JSON.parse(await readFile(Path.historyIndex(session.id), 'utf8'))
            expect(manifest.format).toBe(2)
            expect(manifest.segments).toHaveLength(2)
            expect(manifest.segments[0].count).toBe(2)
            expect(manifest.segments[0].compact.message.compact).toBe(true)
            expect(manifest.current.count).toBe(2)
            expect(await lines(join(Path.historyArchives(session.id), manifest.segments[0].file))).toHaveLength(2)
            expect(await lines(join(Path.historyArchives(session.id), 'current.jsonl'))).toHaveLength(2)

            History.clear()
            const loaded = await History.load(session.id)
            expect(loaded.history.messages.map(record => record.message.content)).toEqual([
                text('第一段问题'), text('第一段回答'), '## 第一次压缩\n摘要一',
                text('第二段问题'), text('第二段回答'), '## 第二次压缩\n摘要二',
                text('当前问题'), text('当前回答'),
            ])
            expect(loaded.history.segmented).toBe(true)
        })
    })

    test('当前段只追加，封存段不变', async () => {
        await withHome(async root => {
            const session = await History.create({ title: '追加', cwd: root, settings: { reasoning: 'auto' } })
            await append(History, session.id, [user('旧问题'), assistant('旧回答'), compact('摘要'), user('当前问题')])
            const manifest = JSON.parse(await readFile(Path.historyIndex(session.id), 'utf8'))
            const segmentFile = join(Path.historyArchives(session.id), manifest.segments[0].file)
            const before = await readFile(segmentFile, 'utf8')
            const currentFile = join(Path.historyArchives(session.id), 'current.jsonl')
            const currentBefore = await readFile(currentFile, 'utf8')

            await append(History, session.id, [assistant('后续回答')])
            expect(await readFile(segmentFile, 'utf8')).toBe(before)
            const currentAfter = await readFile(currentFile, 'utf8')
            expect(currentAfter.startsWith(currentBefore)).toBe(true)
            expect(await lines(currentFile)).toHaveLength(2)
            expect(JSON.parse(await readFile(Path.historyIndex(session.id), 'utf8')).current.count).toBe(2)
        })
    })

    test('后续出现新的 compact 时重新分段，旧段仍然正确', async () => {
        await withHome(async root => {
            const session = await History.create({ title: '再分段', cwd: root, settings: { reasoning: 'auto' } })
            await append(History, session.id, [user('旧问题'), assistant('旧回答'), compact('摘要一'), user('当前问题')])
            await append(History, session.id, [assistant('当前回答'), user('第二段问题'), assistant('第二段回答'), compact('摘要二'), user('最新问题')])

            const manifest = JSON.parse(await readFile(Path.historyIndex(session.id), 'utf8'))
            expect(manifest.segments).toHaveLength(2)
            expect(manifest.segments[0].count).toBe(2)
            expect(manifest.segments[1].count).toBe(4)
            expect(manifest.current.count).toBe(1)
            History.clear()
            const loaded = await History.load(session.id)
            expect(loaded.history.messages).toHaveLength(9)
            expect(loaded.history.messages.at(-1).message.content).toEqual(text('最新问题'))
        })
    })

    test('page 只返回 manifest 和当前段，segment 按需读取', async () => {
        await withHome(async root => {
            const session = await History.create({ title: '按需', cwd: root, settings: { reasoning: 'auto' } })
            await append(History, session.id, [
                user('旧问题'), assistant('旧回答'), compact('旧摘要'),
                user('当前问题'), assistant('当前回答'),
            ])
            const page = History.page({ sessionId: session.id })
            expect(page.manifest.segments).toHaveLength(1)
            expect(page.manifest.segments[0].compact.messageId).toBeTruthy()
            expect(page.current.map(message => message.content)).toEqual([text('当前问题'), text('当前回答')])

            const segment = await History.segment({ sessionId: session.id, segmentId: page.manifest.segments[0].id })
            expect(segment.messages.map(message => message.content)).toEqual([text('旧问题'), text('旧回答')])
            await expect(History.segment({ sessionId: session.id, segmentId: 'missing' })).rejects.toThrow('History segment not found')
        })
    })

    test('回退跨段后重写分段，旧段不会留下被回退消息', async () => {
        await withHome(async root => {
            const session = await History.create({ title: '回退', cwd: root, settings: { reasoning: 'auto' } })
            await append(History, session.id, [user('a'), assistant('b'), compact('摘要'), user('c'), assistant('d')])
            const target = History.get({ sessionId: session.id }).find(message => message.content?.[0]?.text === 'c').messageId
            await History.rollback({ sessionId: session.id, messageId: target })
            await History.save(session.id)

            const manifest = JSON.parse(await readFile(Path.historyIndex(session.id), 'utf8'))
            expect(manifest.segments).toHaveLength(1)
            expect(await lines(join(Path.historyArchives(session.id), 'current.jsonl'))).toHaveLength(0)
            expect(await lines(join(Path.historyArchives(session.id), manifest.segments[0].file))).toHaveLength(2)
            History.clear()
            const loaded = await History.load(session.id)
            expect(loaded.history.messages.map(record => record.message.content)).toEqual([text('a'), text('b'), '摘要'])
        })
    })

    test('旧 JSONL 里已有 compact 时，首次加载自动迁移成分段', async () => {
        await withHome(async root => {
            const session = await History.create({ title: '迁移', cwd: root, settings: { reasoning: 'auto' } })
            const records = [
                { messageId: 'u1', message: user('旧问题') },
                { messageId: 'c1', message: compact('迁移摘要') },
                { messageId: 'u2', message: user('当前问题') },
            ]
            await Bun.write(Path.historyLog(session.id), records.map(record => `${JSON.stringify(record)}\n`).join(''))
            History.clear()

            const loaded = await History.load(session.id)
            expect(loaded.history.segmented).toBe(true)
            expect(await Bun.file(Path.historyIndex(session.id)).exists()).toBe(true)
            expect(await Bun.file(Path.historyLog(session.id)).exists()).toBe(false)
            const page = History.page({ sessionId: session.id })
            expect(page.manifest.segments).toHaveLength(1)
            expect(page.current).toHaveLength(1)
        })
    })
})
