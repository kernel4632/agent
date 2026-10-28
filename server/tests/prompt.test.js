/*
 * 系统提示词初始化测试：默认值只填一次，用户清空后不能被重新填回。
 *
 * 规则拼接是另一件事，这里把 rules 关掉，只看用户提示词本身。
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import Config from '../config/config.js'
import Store from '../state/store.js'
import { DEFAULT_SYSTEM_PROMPT } from '../config/system-prompt.js'

const withHome = async callback => {
    const root = join(tmpdir(), `agent-prompt-${crypto.randomUUID()}`)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    await mkdir(root, { recursive: true })
    Object.keys(Store.config).forEach(key => delete Store.config[key])
    Store.rules = ''
    try {
        return await callback(root)
    } finally {
        if (previousHome === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previousHome
        await rm(root, { recursive: true, force: true })
    }
}

const provider = [{ name: 'local', models: ['model'] }]

describe('默认系统提示词', () => {
    test('第一次读取时填入默认值并留下初始化标记', async () => {
        await withHome(async root => {
            const path = join(root, 'config.json')
            await writeFile(path, JSON.stringify({ providers: provider }))

            const config = await Config.read(path)
            expect(config.prompt.system).toBe(DEFAULT_SYSTEM_PROMPT)
            expect(config.prompt.defaultSeeded).toBe(true)
        })
    })

    test('用户写过的提示词不会被默认值覆盖', async () => {
        await withHome(async root => {
            const path = join(root, 'config.json')
            await writeFile(path, JSON.stringify({ providers: provider, prompt: { system: '我的提示词' } }))

            const config = await Config.read(path)
            expect(config.prompt.system).toBe('我的提示词')
            expect(config.prompt.defaultSeeded).toBe(true)
        })
    })

    test('用户明确保存的空提示词在下一次读取时保持为空', async () => {
        await withHome(async root => {
            const path = join(root, 'config.json')
            await writeFile(path, JSON.stringify({
                providers: provider,
                rules: { enabled: false },
                prompt: { system: '', defaultSeeded: true },
            }))

            await Config.read(path)
            expect(Store.config.prompt.system).toBe('')
            expect(Config.resolve({ provider: 'local', model: 'model' }).system).toBe('')
        })
    })

    test('通过 Config.set 提交空提示词也会被保留', async () => {
        await withHome(async () => {
            await Config.set({
                providers: provider,
                rules: { enabled: false },
                prompt: { system: '' },
            })
            expect(Store.config.prompt.system).toBe('')
            expect(Config.resolve({ provider: 'local', model: 'model' }).system).toBe('')
        })
    })

    test('空提示词不会让 agent-core 再请求一轮', async () => {
        await withHome(async () => {
            await Config.set({ providers: provider, prompt: { system: '' } })
            const config = Config.resolve({ provider: 'local', model: 'model' })
            expect(config.noToolRounds).toBe(1)
        })
    })
})
