import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'bun:test'
import { nanoid } from 'nanoid'
import Store from '../store.js'
import Workspace from '../commands/workspace.js'
import Session from '../commands/session.js'
import Checkpoint from '../features/checkpoint.js'
import Fork from '../features/fork.js'
import Permission from '../features/permission.js'
import Compact from '../features/compact.js'
import Agent from '../commands/agent.js'
import Path from '../utils/path.js'

beforeEach(async () => {
    process.env.AGENT_HOME = join(tmpdir(), `agent-core-${nanoid()}`)
    await mkdir(process.env.AGENT_HOME, { recursive: true })
    Store.workspaces = {}; Store.sessions = {}; Store.runtimes = {}
    await Store.load()
})
const provider = port => [{
    name: 'mock', baseURL: `http://127.0.0.1:${port}/v1`, key: 'test',
    models: [{ id: 'model', contextWindow: 1000, maxOutput: 100 }],
}]

describe('plaintext data line', () => {
    test('reloads workspaces, session metadata and JSONL messages', async () => {
        const workspace = await Workspace.add(process.env.AGENT_HOME)
        const session = await Session.create(workspace.id, 'openai', 'model')
        await Session.append(session.id, { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hello' }] })
        Store.workspaces = {}; Store.sessions = {}; Store.runtimes = {}
        await Store.load()
        expect(Store.sessions[session.id].messages[0].parts[0].text).toBe('hello')
        expect(Store.workspaces[workspace.id].sessions[0].id).toBe(session.id)
    })

    test('rollback and undo restore exact messages and files', async () => {
        const workspace = await Workspace.add(process.env.AGENT_HOME)
        const session = await Session.create(workspace.id, 'openai', 'model')
        const file = join(process.env.AGENT_HOME, 'work.txt')
        await Bun.write(file, 'before')
        await Session.append(session.id, { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'request' }] })
        await Session.append(session.id, {
            id: 'a1', role: 'assistant',
            parts: [{ type: 'tool-file_write', toolCallId: 'c1', state: 'input-available', input: {} }],
        })
        await Checkpoint.save(session.id, { messageID: 'a1', partIndex: 0 }, file)
        await Bun.write(file, 'after')
        await Session.append(session.id, { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'next' }] })
        const exact = structuredClone(session.messages)
        await Checkpoint.rollback(session.id, { messageID: 'a1', partIndex: 0 })
        expect(await Bun.file(file).text()).toBe('before')
        expect(session.messages.map(message => message.id)).toEqual(['u1'])
        await Checkpoint.undo(session.id)
        expect(await Bun.file(file).text()).toBe('after')
        expect(session.messages).toEqual(exact)
    })

    test('checkpoint reports unreadable history instead of replacing it', async () => {
        const workspace = await Workspace.add(process.env.AGENT_HOME)
        const session = await Session.create(workspace.id, 'openai', 'model')
        const file = join(process.env.AGENT_HOME, 'work.txt')
        await Bun.write(file, 'content')
        await mkdir(`${Path.undo(session.id)}.jsonl`, { recursive: true })
        await expect(Checkpoint.save(session.id, { messageID: 'a1', partIndex: 0 }, file)).rejects.toBeDefined()
    })

test('fork truncates at one part without changing the source', async () => {
        const workspace = await Workspace.add(process.env.AGENT_HOME)
        const source = await Session.create(workspace.id, 'openai', 'model')
        await Session.append(source.id, {
            id: 'u1', role: 'user',
            parts: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }],
        })
        const fork = await Fork.create(source.id, { messageID: 'u1', partIndex: 1 })
        expect(fork.messages[0].parts).toEqual([{ type: 'text', text: 'one' }])
    expect(source.messages[0].parts).toHaveLength(2)
    })

})

test('permission waits for and applies an allow-once decision', async () => {
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'openai', 'model')
    const pending = Permission.request(session.id, 'call-1', 'shell', { command: 'pwd' })
    await Bun.sleep(0)
    let settled = false
    pending.then(() => { settled = true })
    await Bun.sleep(30)
    expect(settled).toBe(false)
    expect(await Permission.decide(session.id, 'call-1', 'allow', 'once')).toBe(true)
    expect(await pending).toBe(true)
})

test('allow always persists a matching permission rule', async () => {
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'openai', 'model')
    const input = { command: 'pwd' }
    const pending = Permission.request(session.id, 'call-always', 'shell', input)
    await Bun.sleep(0)
    expect(await Permission.decide(session.id, 'call-always', 'allow', 'always')).toBe(true)
    expect(await pending).toBe(true)
    expect(Store.config.permission.at(-1)).toEqual({ tool: 'shell', match: JSON.stringify(input), action: 'allow' })
})

test('a running session replays cached SSE events after reconnect', async () => {
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'missing', 'missing')
    Store.runtimes[session.id].status = 'running'
    Store.runtimes[session.id].abortController = new AbortController()
    await Store.broadcast(session.id, { type: 'data-test', data: { value: 1 } })
    const first = Session.listen(session.id).getReader()
    await first.read()
    expect((await first.read()).value.type).toBe('data-test')
    await first.cancel()
    const second = Session.listen(session.id).getReader()
    await second.read()
    expect((await second.read()).value.type).toBe('data-test')
    Store.runtimes[session.id].status = 'idle'
    await Store.broadcast(session.id, { type: 'data-status', data: { status: 'idle' } })
})

test('overlapping sends serialize and leave the newest run in control', async () => {
    let requests = 0
    const model = Bun.serve({ port: 0, fetch: () => {
        requests += 1
        const call = {
            index: 0, id: 'finish-overlap', type: 'function',
            function: { name: 'finish', arguments: '{"result":"done"}' },
        }
        const body = { choices: [{ delta: { role: 'assistant', tool_calls: [call] }, finish_reason: 'tool_calls' }] }
        return new Response(`data: ${JSON.stringify(body)}\n\ndata: [DONE]\n\n`, {
            headers: { 'content-type': 'text/event-stream' },
        })
    } })
    Store.config.providers = provider(model.port)
    Store.config.permission = [{ tool: '*', match: '*', action: 'allow' }]
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'mock', 'model')
    const append = Session.append
    let appends = 0
    let release
    Session.append = async (...arguments_) => {
        const order = ++appends
        await append(...arguments_)
        if (order === 1) await new Promise(resolve => { release = resolve })
    }

    const first = Agent.send(session.id, 'first')
    while (!release) await Bun.sleep(5)
    await Agent.send(session.id, 'second')
    while (Store.runtimes[session.id].status === 'running') await Bun.sleep(5)
    release()
    await first
    Session.append = append
    model.stop()
    const messages = session.messages.filter(message => message.role === 'user')
        .map(message => message.parts[0].text)
    expect(messages).toEqual(['first', 'second'])
    expect(requests).toBe(1)
    expect(Store.runtimes[session.id].status).toBe('idle')
})

test('a stopped loop cannot finish a newer live run', async () => {
    let calls = 0
    let release
    const model = Bun.serve({ port: 0, fetch: request => {
        calls += 1
        if (calls === 1) return new Promise(resolve => {
            request.signal.addEventListener('abort', () => resolve(new Response('', { status: 499 })), { once: true })
        })
        return new Promise(resolve => {
            release = () => resolve(new Response([
                `data: ${JSON.stringify({ choices: [{ delta: {
                    role: 'assistant', tool_calls: [{
                        index: 0, id: 'finish', type: 'function',
                        function: { name: 'finish', arguments: '{"result":"done"}' },
                    }],
                }, finish_reason: null }] })}\n\n`,
                'data: [DONE]\n\n',
            ].join(''), { headers: { 'content-type': 'text/event-stream' } }))
        })
    } })
    Store.config.providers = provider(model.port)
    Store.config.permission = [{ tool: '*', match: '*', action: 'allow' }]
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'mock', 'model')
    await Agent.send(session.id, 'first')
    while (calls < 1) await Bun.sleep(5)
    await Agent.send(session.id, 'second')
    while (calls < 2) await Bun.sleep(5)
    await Bun.sleep(20)
    expect(Store.runtimes[session.id].status).toBe('running')
    release()
    while (Store.runtimes[session.id].status === 'running') await Bun.sleep(5)
    model.stop()
})

test('removing a live session prevents late saves and broadcasts', async () => {
    let started = false
    const model = Bun.serve({ port: 0, fetch: request => new Promise(resolve => {
        started = true
        request.signal.addEventListener('abort', () => resolve(new Response('', { status: 499 })), { once: true })
    }) })
    Store.config.providers = provider(model.port)
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'mock', 'model')
    await Agent.send(session.id, 'wait')
    while (!started) await Bun.sleep(5)
    expect(await Session.remove(session.id)).toBe(true)
    await Bun.sleep(20)
    model.stop()
    expect(Store.sessions[session.id]).toBeUndefined()
    expect(Store.runtimes[session.id]).toBeUndefined()
})

test('failed manual compact restores idle state', async () => {
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'missing', 'missing')
    await expect(Compact.run(session.id)).rejects.toThrow('Session model is not configured')
    expect(Store.runtimes[session.id].status).toBe('idle')
})

test('stop waits for a standalone compact task', async () => {
    let aborted = false
    const model = Bun.serve({ port: 0, fetch: request => new Promise(resolve => {
        request.signal.addEventListener('abort', () => {
            aborted = true
            resolve(new Response('', { status: 499 }))
        }, { once: true })
    }) })
    Store.config.providers = provider(model.port)
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'mock', 'model')
    await Session.append(session.id, { id: 'prompt', role: 'user', parts: [{ type: 'text', text: 'summarize' }] })
    const compact = Compact.run(session.id).catch(() => {})
    await Bun.sleep(20)
    expect(await Agent.stop(session.id)).toBe(true)
    await compact
    model.stop()
    expect(aborted || Store.runtimes[session.id].status === 'idle').toBe(true)
    expect(Store.runtimes[session.id].status).toBe('idle')
})

test('an old compact task cannot finish a newer agent run', async () => {
    let calls = 0
    const model = Bun.serve({ port: 0, fetch: request => new Promise(resolve => {
        calls += 1
        request.signal.addEventListener('abort', () => resolve(new Response('', { status: 499 })), { once: true })
    }) })
    Store.config.providers = provider(model.port)
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'mock', 'model')
    await Session.append(session.id, { id: 'prompt', role: 'user', parts: [{ type: 'text', text: 'summarize' }] })
    const compact = Compact.run(session.id).catch(() => {})
    while (calls < 1) await Bun.sleep(5)
    await Agent.send(session.id, 'new run')
    while (calls < 2) await Bun.sleep(5)
    await compact
    expect(Store.runtimes[session.id].status).toBe('running')
    Agent.stop(session.id)
    while (Store.runtimes[session.id].status === 'running') await Bun.sleep(5)
    model.stop()
})

test('session update and append preserve both changes on disk', async () => {
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'missing', 'missing')
    await Promise.all([
        Session.append(session.id, { id: 'message', role: 'user', parts: [{ type: 'text', text: 'hello' }] }),
        Session.update(session.id, { title: 'Title' }),
    ])
    Store.sessions = {}; Store.workspaces = {}; Store.runtimes = {}
    await Store.load()
    expect(Store.sessions[session.id].messages).toHaveLength(1)
    expect(Store.workspaces[workspace.id].sessions[0].title).toBe('Title')
})

test('concurrent workspace saves keep every workspace', async () => {
    const first = join(process.env.AGENT_HOME, 'first')
    const second = join(process.env.AGENT_HOME, 'second')
    await mkdir(first, { recursive: true })
    await mkdir(second, { recursive: true })
    const [one, two] = await Promise.all([Workspace.add(first), Workspace.add(second)])

    Store.workspaces = {}
    Store.sessions = {}
    Store.runtimes = {}
    await Store.load()

    expect(Object.keys(Store.workspaces)).toEqual(expect.arrayContaining([one.id, two.id]))
})

test('corrupt config is reported without being overwritten', async () => {
    await Bun.write(join(process.env.AGENT_HOME, 'config.json'), '{broken')
    await expect(Store.load()).rejects.toThrow()
    expect(await Bun.file(join(process.env.AGENT_HOME, 'config.json')).text()).toBe('{broken')
})

test('permission resolves false when the agent is stopped', async () => {
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'missing', 'missing')
    const runtime = Store.runtimes[session.id]
    runtime.status = 'running'
    const pending = Permission.request(session.id, 'call-stop', 'shell', { command: 'sleep 1' })
    runtime.abortController.abort()
    expect(await pending).toBe(false)
})
