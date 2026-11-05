import { afterEach, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { app } from '../server.js'
import ModelIcons from '../features/model-icons.js'

const homes = []
afterEach(async () => {
    await Promise.all(homes.splice(0).map(root => rm(root, { recursive: true, force: true })))
    ModelIcons.clear()
})

test('显式 family 直接返回，不需要下载模型目录', async () => {
    const response = await app.handle(new Request('http://localhost/model/family?family=deepseek'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
        family: 'deepseek',
        candidates: ['deepseek'],
        ambiguous: false,
        source: 'manual',
    })
})

test('canonical 原厂信息优先于托管同名模型的平台', async () => {
    const root = join(tmpdir(), `agent-model-icons-${crypto.randomUUID()}`)
    homes.push(root)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    try {
        await mkdir(join(root, 'cache'), { recursive: true })
        await writeFile(join(root, 'cache', 'models-dev.json'), JSON.stringify({
            moonshotai: {
                models: {
                    'kimi-k2.6': { id: 'kimi-k2.6', canonical_model_id: 'moonshotai/kimi-k2.6' },
                },
            },
            'alibaba-cn': {
                models: {
                    'kimi-k2.6': { id: 'kimi-k2.6' },
                },
            },
        }))
        ModelIcons.clear()

        const result = await ModelIcons.suggest({ model: 'kimi-k2.6' })
        expect(result).toMatchObject({
            family: 'moonshotai',
            candidates: ['moonshotai'],
            ambiguous: false,
        })
    } finally {
        if (previousHome === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previousHome
    }
})
