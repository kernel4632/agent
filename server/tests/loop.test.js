import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, test } from 'bun:test'
import { nanoid } from 'nanoid'
import Store from '../store.js'
import Workspace from '../commands/workspace.js'
import Session from '../commands/session.js'
import Agent from '../commands/agent.js'
import Permission from '../features/permission.js'

beforeEach(async () => {
    process.env.AGENT_HOME = join(tmpdir(), `agent-loop-${nanoid()}`)
    await mkdir(process.env.AGENT_HOME, { recursive: true })
    Store.workspaces = {}; Store.sessions = {}; Store.runtimes = {}
    await Store.load()
})

const wait = async session => { while (Store.runtimes[session.id].status === 'running') await Bun.sleep(5) }
const response = tool => {
    const call = {
        index: 0, id: tool.id, type: 'function',
        function: { name: tool.name, arguments: tool.arguments },
    }
    const body = { choices: [{ delta: { role: 'assistant', tool_calls: [call] } }] }
    return new Response([
        `data: ${JSON.stringify(body)}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`,
        'data: [DONE]\n\n',
    ].join(''), { headers: { 'content-type': 'text/event-stream' } })
}
const textResponse = text => {
    const body = { choices: [{ delta: { role: 'assistant', content: text }, finish_reason: 'stop' }] }
    return new Response([
        `data: ${JSON.stringify(body)}\n\n`,
        'data: [DONE]\n\n',
    ].join(''), { headers: { 'content-type': 'text/event-stream' } })
}
const provider = (port, contextWindow = 100000) => [{
    name: 'mock', baseURL: `http://127.0.0.1:${port}/v1`, key: 'test',
    models: [{ id: 'model', contextWindow, maxOutput: 1000 }],
}]

test('runs a real OpenAI-compatible tool round through finish', async () => {
    const target = join(process.env.AGENT_HOME, 'result.txt')
    let step = 0
    const model = Bun.serve({ port: 0, fetch: () => {
        step += 1
        return response(step === 1
            ? { id: 'write', name: 'file_write', arguments: JSON.stringify({ path: target, content: 'written' }) }
            : { id: 'finish', name: 'finish', arguments: JSON.stringify({ result: 'done' }) })
    } })
    Store.config.providers = provider(model.port)
    Store.config.permission = [{ tool: '*', match: '*', action: 'allow' }]
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'mock', 'model')
    await Agent.send(session.id, 'write the file and finish')
    await wait(session)
    model.stop()
    expect(await Bun.file(target).text()).toBe('written')
    expect(step).toBe(2)
    expect(session.messages.some(message => message.parts.some(part => part.state === 'output-available'))).toBe(true)
})

test('executes multiple tool calls from one model message in parallel', async () => {
    const first = join(process.env.AGENT_HOME, 'first.txt')
    const second = join(process.env.AGENT_HOME, 'second.txt')
    let step = 0
    const model = Bun.serve({ port: 0, fetch: () => {
        step += 1
        if (step > 1) {
            return response({ id: 'finish-many', name: 'finish', arguments: JSON.stringify({ result: 'done' }) })
        }
        const calls = [first, second].map((path, index) => ({
            index, id: `write-${index}`, type: 'function',
            function: { name: 'file_write', arguments: JSON.stringify({ path, content: path }) },
        }))
        const body = { choices: [
            { delta: { role: 'assistant', tool_calls: calls }, finish_reason: null },
            { delta: {}, finish_reason: 'tool_calls' },
        ] }
        return new Response(`data: ${JSON.stringify(body)}\n\ndata: [DONE]\n\n`, {
            headers: { 'content-type': 'text/event-stream' },
        })
    } })
    Store.config.providers = provider(model.port)
    Store.config.permission = [{ tool: '*', match: '*', action: 'allow' }]
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'mock', 'model')
    await Agent.send(session.id, 'write both files and finish')
    await wait(session)
    model.stop()
    expect(await Bun.file(first).text()).toBe(first)
    expect(await Bun.file(second).text()).toBe(second)
})

test('keeps a long tool loop alive until the finish tool stops it', async () => {
    let step = 0
    const model = Bun.serve({ port: 0, fetch: () => {
        step += 1
        return response(step <= 8
            ? { id: `list-${step}`, name: 'file_list', arguments: JSON.stringify({ path: process.env.AGENT_HOME }) }
            : { id: 'finish-long', name: 'finish', arguments: JSON.stringify({ result: 'done' }) })
    } })
    Store.config.providers = provider(model.port)
    Store.config.permission = [{ tool: '*', match: '*', action: 'allow' }]
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'mock', 'model')
    await Agent.send(session.id, 'keep inspecting until finished')
    await wait(session)
    model.stop()
    expect(step).toBe(9)
    const outputs = session.messages.flatMap(message => message.parts)
        .filter(part => part.state === 'output-available')
    expect(outputs).toHaveLength(9)
})

test('does not compact again while the latest summary is recent', async () => {
    let step = 0
    const model = Bun.serve({ port: 0, fetch: () => {
        step += 1
        return step === 1
            ? textResponse('summary')
            : response({ id: 'finish-summary', name: 'finish', arguments: JSON.stringify({ result: 'done' }) })
    } })
    Store.config.providers = provider(model.port, 100)
    Store.config.context = { compactRatio: 0.1, idleRounds: 3 }
    Store.config.permission = [{ tool: '*', match: '*', action: 'allow' }]
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'mock', 'model')
    await Agent.send(session.id, 'x'.repeat(1000))
    await wait(session)
    model.stop()
    expect(step).toBe(2)
    expect(session.messages.filter(message => message.summary)).toHaveLength(1)
})

test('publishes a denied tool part and continues the model loop', async () => {
    let step = 0
    const model = Bun.serve({ port: 0, fetch: () => {
        step += 1
        return response(step === 1
            ? { id: 'denied', name: 'file_list', arguments: JSON.stringify({ path: process.env.AGENT_HOME }) }
            : { id: 'finish-denied', name: 'finish', arguments: JSON.stringify({ result: 'done' }) })
    } })
    Store.config.providers = provider(model.port)
    Store.config.permission = [
        { tool: 'file_list', match: '*', action: 'ask' },
        { tool: 'finish', match: '*', action: 'allow' },
    ]
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'mock', 'model')
    const events = []
    Store.runtimes[session.id].clients.add({ enqueue: event => events.push(event), close() {} })
    await Agent.send(session.id, 'ask for a file list')
    while (!Store.runtimes[session.id].permission.size
        && Store.runtimes[session.id].status === 'running') await Bun.sleep(5)
    expect(await Permission.decide(session.id, 'denied', 'deny', 'once')).toBe(true)
    await wait(session)
    model.stop()
    const parts = session.messages.flatMap(message => message.parts)
    expect(parts.some(part => part.toolCallId === 'denied' && part.state === 'output-denied')).toBe(true)
    expect(events.some(event => event.type === 'tool-output-denied')).toBe(true)
})

test('passes an image read result to the next model request as media', async () => {
    const image = join(process.env.AGENT_HOME, 'image.png')
    await Bun.write(image, 'not-a-real-png')
    const requests = []
    let step = 0
    const model = Bun.serve({ port: 0, fetch: async request => {
        requests.push(await request.json())
        step += 1
        return response(step === 1
            ? { id: 'read-image', name: 'file_read', arguments: JSON.stringify({ path: image }) }
            : { id: 'finish-image', name: 'finish', arguments: JSON.stringify({ result: 'done' }) })
    } })
    Store.config.providers = provider(model.port)
    Store.config.permission = [{ tool: '*', match: '*', action: 'allow' }]
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'mock', 'model')
    await Agent.send(session.id, 'read the image and finish')
    await wait(session)
    model.stop()
    expect(requests).toHaveLength(2)
    expect(JSON.stringify(requests[1])).toContain('image')
    expect(JSON.stringify(requests[1])).not.toContain('"type":"file"')
})
