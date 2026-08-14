import { describe, expect, it } from 'bun:test'
import Store from '../store.ts'
import LLM from '../utils/llm.ts'
import pRetry from 'p-retry'
import Error from '../utils/error.ts'
import Retry from '../utils/retry.ts'

describe('OpenAI-compatible model flow', () => {
    it('streams a real OpenAI-compatible response and records cache usage', async () => {
        let request: any
        const server = Bun.serve({
            port: 0,
            async fetch(input) {
                request = await input.json()
                return new Response([
                    'data: ' + JSON.stringify({ choices: [{ delta: { role: 'assistant', content: 'hello' }, finish_reason: null }] }) + '\n\n',
                    'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: {
                        prompt_tokens: 12,
                        completion_tokens: 2,
                        total_tokens: 14,
                        prompt_tokens_details: { cached_tokens: 8 },
                    } }) + '\n\n',
                    'data: [DONE]\n\n',
                ].join(''), { headers: { 'content-type': 'text/event-stream' } })
            },
        })
        Store.config.providers = [{
            name: 'mock',
            baseURL: `http://127.0.0.1:${server.port}/v1`,
            key: 'test',
            models: [{ id: 'mock-model', contextWindow: 10000, maxOutput: 1000 }],
        }]
        const provider = Store.config.providers[0]!
        const model = provider.models[0]!
        const result = await LLM.chat({
            provider,
            model,
            retry: Store.config.retry,
            messages: [{ role: 'user', content: 'say hello' }],
            instructions: 'test',
        })
        server.stop()
        expect(request.model).toBe('mock-model')
        expect(result.message.parts.some(part => part.type === 'text' && part.text === 'hello')).toBe(true)
        expect(result.usage.inputTokens).toBe(12)
        expect(result.usage.inputTokenDetails?.cacheReadTokens).toBe(8)
    })

    it('retries transient failures indefinitely until the operation succeeds', async () => {
        const original = Store.config.retry
        Store.config.retry = { baseDelay: 1, factor: 2, maxDelay: 2 }
        let attempts = 0
        const result = await pRetry(async () => {
            attempts += 1
            if (attempts < 3) throw Object.assign(new globalThis.Error('temporary'), { status: 503 })
            return 'ok'
        }, { retries: Infinity, factor: 2, minTimeout: 1, maxTimeout: 2 })
        Store.config.retry = original
        expect(result).toBe('ok')
        expect(attempts).toBe(3)
    })

    it('does not retry permanent or unknown errors', async () => {
        expect(Error.retryable(Object.assign(new globalThis.Error('bad request'), { statusCode: 400, isRetryable: false }))).toBe(false)
        expect(Error.retryable(Object.assign(new globalThis.Error('conflict'), { statusCode: 409, isRetryable: true }))).toBe(false)
        expect(Error.retryable(new globalThis.Error('unknown'))).toBe(false)
        expect(Error.retryable(new TypeError('network unavailable'))).toBe(true)
        expect(Error.retryable(new TypeError('invalid argument'))).toBe(false)
    })

    it('actually retries network TypeErrors through p-retry', async () => {
        let attempts = 0
        const result = await Retry.run(async () => {
            attempts += 1
            if (attempts < 3) throw new TypeError('network unavailable')
            return 'ok'
        }, { baseDelay: 1, factor: 2, maxDelay: 2 })
        expect(result).toBe('ok')
        expect(attempts).toBe(3)
    })

    it('does not retry a permanent TypeError', async () => {
        let attempts = 0
        await expect(Retry.run(async () => {
            attempts += 1
            throw new TypeError('invalid argument')
        }, { baseDelay: 1, factor: 1, maxDelay: 1 })).rejects.toThrow('invalid argument')
        expect(attempts).toBe(1)
    })

    it('stops retrying when aborted', async () => {
        const original = Store.config.retry
        Store.config.retry = { baseDelay: 1000, factor: 2, maxDelay: 2000 }
        const abort = new AbortController()
        let attempts = 0
        const running = pRetry(async () => {
            attempts += 1
            throw Object.assign(new globalThis.Error('temporary'), { status: 503 })
        }, { retries: Infinity, factor: 2, minTimeout: 1000, maxTimeout: 2000, signal: abort.signal })
        await Bun.sleep(10)
        abort.abort(new DOMException('Aborted', 'AbortError'))
        await expect(running).rejects.toThrow('Aborted')
        Store.config.retry = original
        expect(attempts).toBe(1)
    })

    it('retries two empty model streams before succeeding', async () => {
        let attempts = 0
        const server = Bun.serve({ port: 0, fetch: () => {
            attempts += 1
            if (attempts < 3) return new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
            return new Response(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: 'recovered' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
        } })
        Store.config.providers = [{ name: 'empty', baseURL: `http://127.0.0.1:${server.port}/v1`, key: 'test', models: [{ id: 'model', contextWindow: 1000, maxOutput: 100 }] }]
        const provider = Store.config.providers[0]!
        const result = await LLM.chat({ provider, model: provider.models[0]!, retry: Store.config.retry, messages: [{ role: 'user', content: 'test' }], instructions: 'test' })
        server.stop()
        expect(attempts).toBe(3)
        expect(result.message.parts.some(part => part.type === 'text' && part.text === 'recovered')).toBe(true)
    })
})
