import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ContextRatios from '../utils/context-ratios.js'
import Path from '../utils/path.js'

const homes = []
const withHome = async callback => {
    const root = await mkdtemp(join(tmpdir(), 'agent-context-ratios-'))
    homes.push(root)
    const previous = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    Path.lock(root)
    ContextRatios.clear()
    try {
        return await callback(root)
    } finally {
        ContextRatios.clear()
        Path.unlock()
        if (previous === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previous
    }
}

afterEach(async () => {
    await Promise.all(homes.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('上下文倍率宿主缓存', () => {
    test('只保存真实 usage 学到的比例，按 provider + model 隔离', async () => {
        await withHome(async () => {
            await ContextRatios.remember({ provider: 'aker', model: 'm1', ratio: 0.297, source: 'usage' })
            await ContextRatios.remember({ provider: 'aker', model: 'm2', ratio: 0.41, source: 'usage' })
            await ContextRatios.remember({ provider: 'aker', model: 'm1', ratio: 0.5, source: 'host' })
            await ContextRatios.flush()

            expect((await ContextRatios.read({ provider: 'aker', model: 'm1' })).ratio).toBe(0.297)
            expect((await ContextRatios.read({ provider: 'aker', model: 'm2' })).ratio).toBe(0.41)
            expect(await ContextRatios.read({ provider: 'aker', model: 'missing' })).toBeNull()
        })
    })

    test('清掉内存缓存后仍能从磁盘恢复', async () => {
        await withHome(async () => {
            await ContextRatios.remember({ provider: 'aker', model: 'm', ratio: 0.3, source: 'usage' })
            await ContextRatios.flush()
            ContextRatios.clear()
            expect((await ContextRatios.read({ provider: 'aker', model: 'm' })).ratio).toBe(0.3)
            const file = JSON.parse(await readFile(Path.contextRatios(), 'utf8'))
            expect(Object.keys(file)).toHaveLength(1)
        })
    })

    test('脏比例和损坏文件不影响启动', async () => {
        await withHome(async () => {
            await ContextRatios.remember({ provider: 'aker', model: 'm', ratio: 0, source: 'usage' })
            await Bun.write(Path.contextRatios(), '{broken')
            ContextRatios.clear()
            expect(await ContextRatios.read({ provider: 'aker', model: 'm' })).toBeNull()
        })
    })
})
