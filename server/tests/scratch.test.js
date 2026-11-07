import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import '../server.js'
import Session from '../commands/session.js'
import History from '../features/history.js'
import Path from '../utils/path.js'

const homes = []
const withHome = async callback => {
    const root = await mkdtemp(join(tmpdir(), 'agent-scratch-'))
    homes.push(root)
    const previous = process.env.AGENT_HOME
    const previousTmp = process.env.AGENT_TMP
    process.env.AGENT_HOME = root
    delete process.env.AGENT_TMP
    Path.lock(root)
    History.clear()
    try {
        return await callback(root)
    } finally {
        History.clear()
        Path.unlock()
        if (previous === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previous
        if (previousTmp === undefined) delete process.env.AGENT_TMP
        else process.env.AGENT_TMP = previousTmp
    }
}

afterEach(async () => {
    await Promise.all(homes.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const withModel = async () => {
    const Config = (await import('../features/config.js')).default
    await Config.set({ providers: [{ name: 'local', models: [{ id: 'model', name: 'model' }] }] })
}

describe('临时工作区', () => {
    test('没有指定目录时创建独立临时目录，删除会话时一起清理', async () => {
        await withHome(async root => {
            await withModel()
            const { sessionId } = await Session.create({ title: '临时任务' })
            const session = await Session.read({ sessionId })
            expect(session.temporary).toBe(true)
            expect(session.cwd.startsWith(join(root, 'scratch'))).toBe(true)
            expect((await stat(session.cwd)).isDirectory()).toBe(true)

            await writeFile(join(session.cwd, 'note.txt'), 'scratch')
            await Session.remove({ sessionId })
            expect(await Bun.file(join(session.cwd, 'note.txt')).exists()).toBe(false)
        })
    })

    test('切换工作区后清除临时标记并清理旧目录', async () => {
        await withHome(async root => {
            await withModel()
            const target = join(root, 'workspace')
            await mkdir(target)
            const { sessionId } = await Session.create({ title: '切目录' })
            const before = await Session.read({ sessionId })
            expect(before.temporary).toBe(true)

            const moved = await Session.setCwd({ sessionId, cwd: target })
            expect(moved).toEqual({ id: sessionId, cwd: target, temporary: false })
            const after = await Session.read({ sessionId })
            expect(after.temporary).toBe(false)
            expect(await Bun.file(before.cwd).exists()).toBe(false)
        })
    })

    test('临时目录被系统清掉后重新打开会补建', async () => {
        await withHome(async () => {
            await withModel()
            const { sessionId } = await Session.create({ title: '补目录' })
            const session = await Session.read({ sessionId })
            await rm(session.cwd, { recursive: true, force: true })
            History.remove({ sessionId })

            const reopened = await Session.read({ sessionId })
            expect(reopened.cwd).toBe(session.cwd)
            expect((await stat(reopened.cwd)).isDirectory()).toBe(true)
        })
    })

    test('分支复制临时工作区，不共用目录', async () => {
        await withHome(async () => {
            await withModel()
            const { sessionId } = await Session.create({ title: '源会话' })
            const source = await Session.read({ sessionId })
            await writeFile(join(source.cwd, 'shared.txt'), 'copy me')

            const { sessionId: branchId } = await Session.fork({ sessionId })
            const branch = await Session.read({ sessionId: branchId })
            expect(branch.temporary).toBe(true)
            expect(branch.cwd).not.toBe(source.cwd)
            expect(await readFile(join(branch.cwd, 'shared.txt'), 'utf8')).toBe('copy me')

            await Session.remove({ sessionId })
            expect((await stat(branch.cwd)).isDirectory()).toBe(true)
            await Session.remove({ sessionId: branchId })
        })
    })
})
