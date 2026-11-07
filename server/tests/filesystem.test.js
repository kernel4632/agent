import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Path from '../utils/path.js'
import Filesystem from '../features/filesystem.js'
import { app } from '../server.js'

const homes = []
const withHome = async callback => {
    const root = await mkdtemp(join(tmpdir(), 'agent-filesystem-'))
    homes.push(root)
    const previous = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    Path.lock(root)
    Filesystem.clear()
    try {
        return await callback(root)
    } finally {
        Path.unlock()
        if (previous === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previous
    }
}

afterEach(async () => {
    Filesystem.clear()
    await Promise.all(homes.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const request = path => app.handle(new Request(`http://localhost/filesystem/entries?path=${encodeURIComponent(path)}&mode=directory`))

describe('文件系统浏览', () => {
    test('只返回目录，按目录优先排序', async () => {
        await withHome(async root => {
            await mkdir(join(root, 'beta'))
            await mkdir(join(root, 'Alpha'))
            await writeFile(join(root, 'file.txt'), 'content')
            const data = await Filesystem.entries({ path: root, mode: 'directory' })
            expect(data.current).toBe(root)
            expect(data.entries.map(entry => entry.name)).toEqual(['Alpha', 'beta'])
            expect(data.entries.every(entry => entry.type === 'directory')).toBe(true)
        })
    })

    test('文件模式同时返回目录和文件', async () => {
        await withHome(async root => {
            await mkdir(join(root, 'folder'))
            await writeFile(join(root, 'a.txt'), 'a')
            const data = await Filesystem.entries({ path: root, mode: 'file' })
            expect(data.entries.map(entry => `${entry.type}:${entry.name}`)).toEqual(['directory:folder', 'file:a.txt'])
        })
    })

    test('路径不存在和错误 mode 都拒绝', async () => {
        await withHome(async root => {
            await expect(Filesystem.entries({ path: join(root, 'missing') })).rejects.toMatchObject({ status: 404 })
            await expect(Filesystem.entries({ path: 'relative/path' })).rejects.toMatchObject({ status: 400 })
            await expect(Filesystem.entries({ path: root, mode: 'all' })).rejects.toMatchObject({ status: 400 })
        })
    })

    test('HTTP 接口返回当前目录和父目录', async () => {
        await withHome(async root => {
            await mkdir(join(root, 'child'))
            const response = await request(join(root, 'child'))
            expect(response.status).toBe(200)
            const data = await response.json()
            expect(data.current).toBe(join(root, 'child'))
            expect(data.parent).toBe(root)
            expect(data.entries).toEqual([])
        })
    })
})
