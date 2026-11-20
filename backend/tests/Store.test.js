import { afterEach, describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataDir, restoreHome } from './mock.js'
import { Store } from '../features/Store.js'
import { Models } from '../features/Models.js'

const original = process.env.AGENT_HOME
afterEach(() => restoreHome(original))

describe('Store', () => {
    test('首次读取会写出空配置，之后整份替换', async () => {
        const home = dataDir()
        const first = await Store.config()
        expect(first).toEqual({ providers: [], models: { chat: '', compact: '' } })
        expect(await readFile(join(home, 'config.json'), 'utf8')).toContain('"providers"')
        const next = { providers: [{ name: 'relay', baseURL: 'http://x', apiKey: 'k', protocol: 'chat', models: [{ id: 'm', context: 1000 }] }], models: { chat: 'relay/m' } }
        await Store.configure(next)
        expect(await Store.config()).toEqual(next)
    })

    test('历史按行追加，截断时整份重写；并发写入不会交错', async () => {
        dataDir()
        await Store.append('main', { id: 'a', role: 'user', content: '一' })
        await Store.append('main', { id: 'b', role: 'assistant', content: [{ type: 'text', text: '二' }] })
        expect(await Store.history('main')).toEqual([
            { id: 'a', role: 'user', content: '一' },
            { id: 'b', role: 'assistant', content: [{ type: 'text', text: '二' }] },
        ])
        await Promise.all([
            Store.append('main', { id: 'c', role: 'user', content: '三' }),
            Store.append('main', { id: 'd', role: 'user', content: '四' }),
        ])
        const ids = (await Store.history('main')).map(message => message.id)
        expect(ids.slice(0, 2)).toEqual(['a', 'b'])
        expect(ids.slice(2).sort()).toEqual(['c', 'd'])
        await Store.write('main', [{ id: 'a', role: 'user', content: '一' }])
        expect(await Store.history('main')).toEqual([{ id: 'a', role: 'user', content: '一' }])
    })

    test('meta 合并写入并带 updatedAt', async () => {
        dataDir()
        const meta = await Store.touch('main', { model: 'relay/m', effort: 'high' })
        expect(meta).toMatchObject({ model: 'relay/m', effort: 'high' })
        expect(meta.updatedAt).toBeNumber()
        const again = await Store.touch('main', { effort: 'low' })
        expect(again).toMatchObject({ model: 'relay/m', effort: 'low' })
    })
})

describe('Models', () => {
    const config = {
        providers: [{
            name: 'relay', baseURL: 'http://x', apiKey: 'secret', protocol: 'chat',
            models: [{
                id: 'grok', name: 'Grok', context: 256000,
                efforts: { low: { provider: { temperature: 0 } }, high: { provider: { temperature: 1 }, maxTokens: 20 } },
            }],
        }],
        models: { chat: 'relay/grok' },
    }

    test('列表用 供应商/模型 作 id，思考强度是档位名', () => {
        expect(Models.list(config)).toEqual([{ id: 'relay/grok', name: 'Grok', context: 256000, efforts: ['low', 'high'] }])
    })

    test('resolve 把档位参数合进 provider，不认识任何供应商；未知档位抛错', () => {
        expect(Models.resolve(config, 'relay/grok', 'high')).toEqual({
            model: 'grok', baseURL: 'http://x', apiKey: 'secret', protocol: 'chat', maxContextTokens: 256000,
            maxTokens: 20, provider: { temperature: 1 },
        })
        expect(() => Models.resolve(config, 'relay/grok', 'mid')).toThrow('不支持思考强度 mid')
        expect(() => Models.resolve(config, 'nope/x')).toThrow('找不到供应商')
    })
})
