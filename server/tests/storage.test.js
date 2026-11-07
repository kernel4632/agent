import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Path from '../utils/path.js'
import Storage from '../features/storage.js'
import { app } from '../server.js'

const homes = []
const withHome = async callback => {
    const root = await mkdtemp(join(tmpdir(), 'agent-storage-'))
    homes.push(root)
    const previousHome = process.env.AGENT_HOME
    const previousSessions = process.env.AGENT_SESSIONS
    process.env.AGENT_HOME = root
    delete process.env.AGENT_SESSIONS
    Path.lock(root)
    try {
        return await callback(root)
    } finally {
        Path.unlock()
        if (previousHome === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previousHome
        if (previousSessions === undefined) delete process.env.AGENT_SESSIONS
        else process.env.AGENT_SESSIONS = previousSessions
    }
}

afterEach(async () => {
    await Promise.all(homes.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const request = (method, body) => app.handle(new Request('http://localhost/storage/sessions', {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
}))

describe('会话数据目录', () => {
    test('默认仍使用 AGENT_HOME/sessions', async () => {
        await withHome(async root => {
            await Storage.prepare()
            expect(Path.sessions()).toBe(join(root, 'sessions'))
            expect((await Storage.status()).pending).toBeNull()
        })
    })

    test('设置新目录只写待迁移标记，重启后复制并切换', async () => {
        await withHome(async root => {
            const old = join(root, 'sessions')
            const target = await mkdtemp(join(tmpdir(), 'agent-storage-target-'))
            homes.push(target)
            await rm(target, { recursive: true, force: true })
            await mkdir(join(old, 's1'), { recursive: true })
            await writeFile(join(old, 's1', 'meta.json'), '{"title":"旧会话"}')

            await Storage.prepare()
            await Storage.setPath(target)
            expect(Path.sessions()).toBe(old)
            const status = await Storage.status()
            expect(status.pending).toEqual({ from: old, path: target })
            expect((await request('GET')).status).toBe(200)

            // 模拟重启：清掉进程内路径缓存后重新 prepare。
            Path.unlock()
            Path.lock(root)
            await Storage.prepare()
            expect(Path.sessions()).toBe(target)
            expect(JSON.parse(await readFile(join(target, 's1', 'meta.json'), 'utf8'))).toEqual({ title: '旧会话' })
            expect(await readFile(join(root, 'sessions-path.json'), 'utf8')).toContain(target.replace(/\\/g, '\\\\'))
            expect((await Storage.status()).pending).toBeNull()
            expect(JSON.parse(await readFile(join(old, 's1', 'meta.json'), 'utf8'))).toEqual({ title: '旧会话' })
        })
    })

    test('API 可以安排和取消迁移，非法目录被拒绝', async () => {
        await withHome(async root => {
            const target = await mkdtemp(join(tmpdir(), 'agent-storage-target-'))
            homes.push(target)
            await rm(target, { recursive: true, force: true })
            await Storage.prepare()

            const invalid = await request('PUT', { path: 'relative/path' })
            expect(invalid.status).toBe(400)
            const created = await request('PUT', { path: target })
            expect(created.status).toBe(200)
            expect((await created.json()).pending.path).toBe(target)
            const status = await request('GET')
            expect((await status.json()).pending.path).toBe(target)
            expect((await request('DELETE')).status).toBe(200)
            expect((await Storage.status()).pending).toBeNull()
        })
    })

    test('已有文件的目录不能作为迁移目标', async () => {
        await withHome(async () => {
            const target = await mkdtemp(join(tmpdir(), 'agent-storage-target-'))
            homes.push(target)
            await writeFile(join(target, 'keep.txt'), 'keep')
            await Storage.prepare()
            const response = await request('PUT', { path: target })
            expect(response.status).toBe(409)
        })
    })

    test('AGENT_SESSIONS 覆盖界面设置', async () => {
        await withHome(async () => {
            const target = await mkdtemp(join(tmpdir(), 'agent-storage-target-'))
            homes.push(target)
            process.env.AGENT_SESSIONS = target
            Path.unlock()
            Path.lock(process.env.AGENT_HOME)
            await Storage.prepare()
            expect(Path.sessions()).toBe(target)
            const response = await request('PUT', { path: join(target, 'other') })
            expect(response.status).toBe(409)
        })
    })
})
