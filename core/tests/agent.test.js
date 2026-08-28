import { expect, test } from 'bun:test'
import Agent from '../index.js'

test('creates independent agents with public state', () => {
    const history = []
    const first = Agent.create({ history })
    const second = Agent.create()

    first.history.push({ role: 'user', content: 'hello' })

    expect(first.history).toBe(history)
    expect(second.history).toEqual([])
    expect(first.config.protocol).toBe('chat')
    expect(first.running).toBeNull()
})

test('builds context with system and tool definitions', () => {
    const context = Agent.context.build({
        history: [{ role: 'user', content: 'hello' }],
        system: 'You are an agent.',
        tools: { read: { description: 'Read messages', inputSchema: {} } },
    })

    expect(context.messages[0]).toEqual({ role: 'system', content: 'You are an agent.' })
    expect(context.messages[1]).toEqual({ role: 'user', content: 'hello' })
    expect(context.token).toBeGreaterThan(0)
})
