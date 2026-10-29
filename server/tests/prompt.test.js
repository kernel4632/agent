/*
 * 系统提示词初始化测试：默认值只填一次，用户清空后不能被重新填回。
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import Settings from '../commands/settings.js'
import Agent from '../features/agent.js'
import Context from '../features/context.js'
import store from '../store.js'

const withHome = async callback => {
    const root = join(tmpdir(), `agent-prompt-${crypto.randomUUID()}`)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    await mkdir(root, { recursive: true })
    Object.keys(store.config).forEach(key => delete store.config[key])
    try {
        return await callback(root)
    } finally {
        if (previousHome === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previousHome
        await rm(root, { recursive: true, force: true })
    }
}

const provider = [{ name: 'local', models: [{ id: 'model', name: 'model' }] }]

const resolve = () => Agent.resolve({
    session: { model: { provider: 'local', model: 'model' } },
    settings: Agent.defaultSettings(),
})

describe('默认系统提示词', () => {
    test('第一次读取时填入默认值并留下初始化标记', async () => {
        await withHome(async root => {
            const path = join(root, 'config.json')
            await writeFile(path, JSON.stringify({ providers: provider }))

            const config = await Settings.read(path)
            expect(config.prompt.system).toBe(Context.DEFAULT_PROMPT)
            expect(config.prompt.seeded).toBe(true)
        })
    })

    test('用户写过的提示词不会被默认值覆盖', async () => {
        await withHome(async root => {
            const path = join(root, 'config.json')
            await writeFile(path, JSON.stringify({ providers: provider, prompt: { system: '我的提示词' } }))

            const config = await Settings.read(path)
            expect(config.prompt.system).toBe('我的提示词')
            expect(config.prompt.seeded).toBe(true)
        })
    })

    test('用户明确保存的空提示词在下一次读取时保持为空', async () => {
        await withHome(async root => {
            const path = join(root, 'config.json')
            await writeFile(path, JSON.stringify({
                providers: provider,
                prompt: { system: '', seeded: true },
            }))

            await Settings.read(path)
            expect(store.config.prompt.system).toBe('')
            expect(resolve().system).toBe('')
        })
    })

    test('通过 Settings.set 提交空提示词也会被保留', async () => {
        await withHome(async () => {
            await Settings.set({
                providers: provider,
                prompt: { system: '' },
            })
            expect(store.config.prompt.system).toBe('')
            expect(resolve().system).toBe('')
        })
    })

    test('空提示词不会让 agent-core 再请求一轮', async () => {
        await withHome(async () => {
            await Settings.set({ providers: provider, prompt: { system: '' } })
            expect(resolve().noToolRounds).toBe(1)
        })
    })
})
