import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Path from '../utils/path.js'
import SessionGroups from '../features/session-groups.js'
import { app } from '../server.js'

const homes = []
const withHome = async callback => {
    const root = await mkdtemp(join(tmpdir(), 'agent-session-groups-'))
    homes.push(root)
    const previous = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    Path.lock(root)
    SessionGroups.clear()
    try {
        return await callback(root)
    } finally {
        SessionGroups.clear()
        Path.unlock()
        if (previous === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previous
    }
}

afterEach(async () => {
    await Promise.all(homes.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

// 分组保存走管理总线；读取随 GET /session/list 一起返回。
const request = (op, body = {}) => app.handle(new Request('http://localhost/admin', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op, ...body }),
}))

describe('session groups', () => {
    test('saves ordered groups and permits empty groups', async () => {
        await withHome(async () => {
            const groups = [
                { id: 'g1', name: '工作', sessions: ['s1', 's2'] },
                { id: 'g2', name: '写作', sessions: [] },
            ]
            const saved = await request('session.groups.set', { groups })
            expect(saved.status).toBe(200)
            expect((await saved.json()).groups).toEqual(groups)

            const read = await app.handle(new Request('http://localhost/session/list'))
            expect(read.status).toBe(200)
            expect((await read.json()).groups).toEqual(groups)
        })
    })

    test('rejects invalid group shapes without changing current state', async () => {
        await withHome(async () => {
            const current = [{ id: 'g1', name: '工作', sessions: ['s1'] }]
            await SessionGroups.save({ groups: current })

            const duplicate = await request('session.groups.set', {
                groups: [
                    { id: 'g1', name: '工作', sessions: ['same'] },
                    { id: 'g2', name: '写作', sessions: ['same'] },
                ],
            })
            expect(duplicate.status).toBe(400)
            expect((await SessionGroups.read()).groups).toEqual(current)
        })
    })

    test('removing a session clears its group assignment', async () => {
        await withHome(async () => {
            await SessionGroups.save({
                groups: [
                    { id: 'g1', name: '工作', sessions: ['s1', 's2'] },
                    { id: 'g2', name: '写作', sessions: ['s3'] },
                ],
            })
            await SessionGroups.removeSession('s1')
            expect((await SessionGroups.read()).groups).toEqual([
                { id: 'g1', name: '工作', sessions: ['s2'] },
                { id: 'g2', name: '写作', sessions: ['s3'] },
            ])
        })
    })
})
