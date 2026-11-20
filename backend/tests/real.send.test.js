/*
一次真实对话：默认不跑（避免日常 bun test 消耗额度）。
需要时：RUN_REAL=1 bun test tests/real.send.test.js

密钥只从 /home/box/secrets/lingloft.env 读，不打印、不写入仓库、不拷到别处。
没有重试，请求 60 秒超时，noToolRounds=1；超过 3 次请求或 90 秒就停。
*/

import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dataDir, restoreHome } from './mock.js'
import { Agents } from '../features/Agents.js'
import { Store } from '../features/Store.js'
import { Loader } from '../features/Loader.js'
import { wire } from '../server.js'
import { join } from 'node:path'

const original = process.env.AGENT_HOME
const REAL = process.env.RUN_REAL === '1'
const builtins = join(import.meta.dir, '../../extensions')

function secrets() {
    const path = '/home/box/secrets/lingloft.env'
    if (!existsSync(path)) return { error: '缺少 /home/box/secrets/lingloft.env' }
    const env = {}
    for (const line of readFileSync(path, 'utf8').split('\n')) {
        const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/)
        if (!match) continue
        env[match[1]] = match[2].replace(/^['"]|['"]$/g, '').trim()
    }
    if (!env.LINGLOFT_API_KEY) return { error: 'lingloft.env 里没有 LINGLOFT_API_KEY' }
    if (!env.LINGLOFT_BASE_URL) return { error: 'lingloft.env 里没有 LINGLOFT_BASE_URL' }
    return { key: env.LINGLOFT_API_KEY, baseURL: env.LINGLOFT_BASE_URL }
}

afterEach(async () => {
    try {
        Agents.peek('main')?.agent.stop()
        await Promise.race([Agents.done('main').catch(() => {}), Bun.sleep(200)])
    } finally {
        Agents.drop('main')
        Loader.reset()
        restoreHome(original)
    }
})

describe('真实请求', () => {
    test.skipIf(!REAL)('对模型说一句话并能收到回复', async () => {
        const cred = secrets()
        if (cred.error) throw new Error(cred.error)
        dataDir()
        wire()
        await Store.configure({
            providers: [{ name: 'relay', baseURL: cred.baseURL, apiKey: cred.key, protocol: 'chat', models: [{ id: 'glm-latest', context: 128000 }] }],
            models: { chat: 'relay/glm-latest' },
            noToolRounds: 1,
            retryMaxTries: 0,
            requestTimeout: 60_000,
            permission: { '*': 'allow' },
        })
        await Loader.start({ roots: [builtins] })
        let starts = 0
        const unsub = (await import('../features/Stream.js')).Stream.subscribe('main', (name, data) => {
            if (name === 'core' && data.type === 'request-start') starts += 1
            if (starts >= 3) void Agents.stop('main')
        })
        const timer = setTimeout(() => void Agents.stop('main'), 90_000)
        try {
            await Agents.open('main')
            await Agents.send('main', { input: '只回复一个字：好' })
            const answer = await Promise.race([Agents.done('main'), Bun.sleep(90_000).then(() => { throw new Error('整轮超过 90 秒') })])
            const history = Agents.peek('main').agent.history
            const texts = history.filter(item => item.role === 'assistant').flatMap(item => Array.isArray(item.content) ? item.content.filter(part => part.type === 'text').map(part => part.text) : [item.content]).join('')
            expect(starts).toBeLessThanOrEqual(3)
            expect(texts.length).toBeGreaterThan(0)
            expect(answer).toBeDefined()
        } finally {
            clearTimeout(timer)
            unsub()
        }
    }, 95_000)
})
