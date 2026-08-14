import { expect, test } from 'bun:test'
import LLM from '../utils/llm.js'

const configured = process.env.RUN_REAL_MODEL === '1' && process.env.AGENT_PROVIDER_URL && process.env.AGENT_PROVIDER_KEY && process.env.AGENT_MODEL
test('real model smoke test', async () => {
    if (!configured) return
    const result = await LLM.stream({
        provider: { name: 'real', baseURL: process.env.AGENT_PROVIDER_URL, key: process.env.AGENT_PROVIDER_KEY },
        model: { id: process.env.AGENT_MODEL, maxOutput: 128 },
        messages: [{ role: 'user', content: 'Reply with exactly the word READY.' }],
        instructions: 'Return only READY.',
        signal: AbortSignal.timeout(60_000),
    })
    expect(result.message.parts.some(part => part.type === 'text' && part.text.includes('READY'))).toBe(true)
})
