import { afterEach, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { app } from '../server.js'
import Path from '../utils/path.js'
import ModelIcons from '../features/model-icons.js'

const homes = []
afterEach(async () => {
    await Promise.all(homes.splice(0).map(root => rm(root, { recursive: true, force: true })))
    ModelIcons.clear()
})

test('显式 family 直接返回，不需要下载模型目录', async () => {
    const response = await app.handle(new Request('http://localhost/admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'model.family', family: 'deepseek' }),
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
        family: 'deepseek',
        candidates: ['deepseek'],
        ambiguous: false,
        source: 'manual',
    })
})

test('暗色主题把 currentColor 换成浅色，浅色主题保持原样', () => {
    const svg = '<svg><path fill="currentColor"/></svg>'
    expect(ModelIcons.themed(svg, 'dark')).toContain('#e6e6e6')
    expect(ModelIcons.themed(svg, 'dark')).not.toContain('currentColor')
    expect(ModelIcons.themed(svg, 'light')).toContain('currentColor')
})

test('优先取 LobeHub 彩色 logo，只把 currentColor 留给主题适配', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async url => String(url).includes('/kimi-color.svg')
        ? new Response('<svg><path fill="#1783FF"/><path fill="currentColor"/></svg>')
        : new Response('not found', { status: 404 })
    try {
        ModelIcons.clear()
        const body = await ModelIcons.icon({ family: 'moonshotai', theme: 'dark' })
        expect(body).toContain('#1783FF')
        expect(body).toContain('#e6e6e6')
        expect(body).not.toContain('currentColor')
    } finally {
        globalThis.fetch = originalFetch
        ModelIcons.clear()
    }
})

test('canonical 原厂信息优先于托管同名模型的平台', async () => {
    const root = join(tmpdir(), `agent-model-icons-${crypto.randomUUID()}`)
    homes.push(root)
    const previousHome = process.env.AGENT_HOME
    process.env.AGENT_HOME = root
    Path.lock(root)   // 锁定数据目录：晚到的异步收尾不会落到真实 ~/.agent
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
        Path.unlock()
        if (previousHome === undefined) delete process.env.AGENT_HOME
        else process.env.AGENT_HOME = previousHome
    }
})
