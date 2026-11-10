import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Config from '../features/config.js'
import Path from '../utils/path.js'
import { app } from '../server.js'

const homes = []
const withHome = async callback => {
    const root = await mkdtemp(join(tmpdir(), 'agent-config-backup-'))
    homes.push(root)
    const previous = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    Path.lock(root)
    try {
        Object.keys(Config.get()).forEach(key => delete Config.get()[key])
        return await callback(root)
    } finally {
        Path.unlock()
        if (previous === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previous
    }
}

afterEach(async () => {
    await Promise.all(homes.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const oldConfig = () => ({
    providers: [{
        name: 'old-provider',
        baseURL: 'https://old.example/v1',
        apiKey: 'secret-old-key',
        protocol: 'openai-compatible',
        models: [{ id: 'old-model', context: 1000000, capabilities: ['text', 'tools'] }],
    }],
    prompt: { system: 'old prompt' },
})

const newConfig = () => ({
    providers: [{
        name: 'new-provider',
        baseURL: 'https://new.example/v1',
        apiKey: 'secret-new-key',
        protocol: 'openai-compatible',
        models: [{ id: 'new-model', context: 2000000, capabilities: ['text'] }],
    }],
    prompt: { system: 'new prompt' },
})

describe('configuration backups', () => {
    test('backup preview masks secrets and restore brings back the previous config', async () => {
        await withHome(async () => {
            await Config.set(oldConfig())
            await Config.set(newConfig())

            const backups = await Config.backups()
            expect(backups.length).toBe(1)
            const preview = await Config.backup(backups[0].id)
            expect(preview.config.providers[0].apiKey).not.toBe('secret-old-key')
            expect(JSON.stringify(preview)).not.toContain('secret-old-key')

            await Config.restore({ id: backups[0].id })
            const restored = Config.get()
            expect(restored.providers[0].name).toBe('old-provider')
            expect(restored.providers[0].models[0].context).toBe(1000000)
            expect(restored.providers[0].apiKey).toBe('secret-old-key')
        })
    })

    test('export is masked by default, full only when explicitly requested', async () => {
        await withHome(async () => {
            await Config.set(oldConfig())
            const masked = Config.export({ secrets: false })
            const full = Config.export({ secrets: true })
            expect(JSON.stringify(masked)).not.toContain('secret-old-key')
            expect(JSON.stringify(full)).toContain('secret-old-key')
        })
    })

    test('import preserves masked keys and rejects invalid config without changing current state', async () => {
        await withHome(async () => {
            await Config.set(oldConfig())
            const masked = Config.export({ secrets: false })
            await Config.import({ config: masked })
            expect(Config.get().providers[0].apiKey).toBe('secret-old-key')

            const before = JSON.stringify(Config.get())
            await expect(Config.import({ config: { providers: [{}] } })).rejects.toThrow()
            expect(JSON.stringify(Config.get())).toBe(before)
        })
    })

    test('HTTP backup list, preview, export and restore stay consistent', async () => {
        await withHome(async () => {
            await Config.set(oldConfig())
            await Config.set(newConfig())

            // 管理面统一走 /admin：{ op, ...参数 }
            const admin = (op, args = {}) => app.handle(new Request('http://localhost/admin', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ op, ...args }),
            }))

            const list = await admin('config.backup.list')
            expect(list.status).toBe(200)
            const backups = await list.json()
            expect(backups.length).toBe(1)

            const preview = await admin('config.backup.read', { id: backups[0].id })
            expect(preview.status).toBe(200)
            expect(JSON.stringify(await preview.json())).not.toContain('secret-old-key')

            const masked = await admin('config.export', { secrets: 0 })
            expect(masked.status).toBe(200)
            expect(await masked.text()).not.toContain('secret-old-key')

            const full = await admin('config.export', { secrets: 1 })
            expect(await full.text()).toContain('secret-new-key')

            const invalid = await admin('config.import', { config: { providers: [{}] } })
            expect(invalid.status).toBe(400)
            expect(Config.get().providers[0].name).toBe('new-provider')

            const restored = await admin('config.restore', { id: backups[0].id })
            expect(restored.status).toBe(200)
            expect(Config.get().providers[0].name).toBe('old-provider')
            expect(Config.get().providers[0].models[0].context).toBe(1000000)
        })
    })
})
