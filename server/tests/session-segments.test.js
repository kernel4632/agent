import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import History from '../features/history.js'
import Path from '../utils/path.js'
import { app } from '../server.js'

const homes = []
const withHome = async callback => {
    const root = await mkdtemp(join(tmpdir(), 'agent-session-segments-'))
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

async function seed(History, root) {
    const session = await History.create({ title: '分段接口', cwd: root, settings: { reasoning: 'auto' } })
    await History.add({ sessionId: session.id, message: { role: 'user', content: text('旧问题') } })
    await History.add({ sessionId: session.id, message: { role: 'assistant', content: text('旧回答') } })
    await History.add({ sessionId: session.id, message: { role: 'user', compact: true, content: '旧摘要' } })
    await History.add({ sessionId: session.id, message: { role: 'user', content: text('当前问题') } })
    await History.add({ sessionId: session.id, message: { role: 'assistant', content: text('当前回答') } })
    await History.save(session.id)
    return session
}

const sseSession = async sessionId => {
    const response = await app.handle(new Request(`http://localhost/session/open/${sessionId}`))
    expect(response.status).toBe(200)
    const body = await response.text()
    const events = body.split('\n\n').filter(Boolean).map(block => {
        const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')
        return JSON.parse(data)
    })
    return events.find(event => event.type === 'session')?.session
}

describe('会话分段读取接口', () => {
    test('open 只返回 manifest 和当前段，segment 再按需返回封存段', async () => {
        await withHome(async root => {
            const session = await seed(History, root)
            const opened = await sseSession(session.id)
            expect(opened.historyTotal).toBe(5)
            expect(opened.history.map(message => message.content)).toEqual([text('当前问题'), text('当前回答')])
            expect(opened.historyManifest.segments).toHaveLength(1)
            expect(opened.historyManifest.segments[0].compact.content).toBe('旧摘要')
            expect(opened.historyManifest.segments[0].messageIds).toHaveLength(2)

            const segmentId = opened.historyManifest.segments[0].id
            const segmentResponse = await app.handle(new Request(`http://localhost/session/segment/${session.id}/${segmentId}`))
            expect(segmentResponse.status).toBe(200)
            const segment = await segmentResponse.json()
            expect(segment.messages.map(message => message.content)).toEqual([text('旧问题'), text('旧回答')])
        })
    })

    test('read 保持完整历史，segmented 不改变普通历史接口', async () => {
        await withHome(async root => {
            const session = await seed(History, root)
            const response = await app.handle(new Request(`http://localhost/session/read/${session.id}`))
            expect(response.status).toBe(200)
            const full = await response.json()
            expect(full.history).toHaveLength(5)
            expect(full.historyManifest).toBeUndefined()
        })
    })
})
