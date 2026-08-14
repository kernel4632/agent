import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, test } from 'bun:test'
import { nanoid } from 'nanoid'
import Store from '../store.js'
import LLM from '../utils/llm.js'
import Retry from '../utils/retry.js'

beforeEach(async () => {
    process.env.AGENT_HOME = join(tmpdir(), `agent-llm-${nanoid()}`)
    await mkdir(process.env.AGENT_HOME, { recursive: true })
    Store.config = structuredClone(Store.defaults)
    await Store.load()
})

test('retries two empty model streams and then returns text', async () => {
    let attempts = 0
    const server = Bun.serve({ port: 0, fetch: () => {
        attempts += 1
        if (attempts < 3) return new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
        return new Response(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: 'ready' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    } })
    const result = await LLM.stream({ provider: { name: 'mock', baseURL: `http://127.0.0.1:${server.port}/v1`, key: 'test' }, model: { id: 'model', maxOutput: 100 }, messages: [{ role: 'user', content: 'test' }], instructions: 'test', signal: AbortSignal.timeout(10_000) })
    server.stop()
    expect(attempts).toBe(3)
    expect(result.message.parts.some(part => part.type === 'text' && part.text === 'ready')).toBe(true)
})

test('retries transient network errors but not permanent errors', async () => {
    Store.config.retry = { baseDelay: 1, factor: 1, maxDelay: 2 }
    let attempts = 0
    expect(await Retry.run(async () => { attempts += 1; if (attempts < 3) throw Object.assign(new Error('busy'), { status: 503 }); return 'ok' }, new AbortController().signal)).toBe('ok')
    expect(attempts).toBe(3)
    attempts = 0
    await expect(Retry.run(async () => { attempts += 1; throw Object.assign(new Error('bad'), { status: 400 }) }, new AbortController().signal)).rejects.toThrow('bad')
    expect(attempts).toBe(1)
})
