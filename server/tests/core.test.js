import { mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'bun:test'
import { nanoid } from 'nanoid'
import Store from '../store.js'
import Workspace from '../commands/workspace.js'
import Session from '../commands/session.js'
import Checkpoint from '../features/checkpoint.js'
import { recover } from '../features/checkpoint.js'
import Fork from '../features/fork.js'
import Permission from '../features/permission.js'
import Compact from '../features/compact.js'
import Agent from '../commands/agent.js'
import Path from '../utils/path.js'

beforeEach(async () => {
    process.env.AGENT_HOME = join(tmpdir(), `agent-core-${nanoid()}`)
    await mkdir(process.env.AGENT_HOME, { recursive: true })
    Store.config = structuredClone(Store.defaults)
    Store.workspaces = {}; Store.sessions = {}; Store.runtimes = {}
    await Store.load()
})

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
        await Session.append(session.id, { id: 'a1', role: 'assistant', parts: [{ type: 'tool-file_write', toolCallId: 'c1', state: 'input-available', input: {} }] })
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

test('fork truncates at one part without changing the source', async () => {
        const workspace = await Workspace.add(process.env.AGENT_HOME)
        const source = await Session.create(workspace.id, 'openai', 'model')
        await Session.append(source.id, { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] })
        const fork = await Fork.create(source.id, { messageID: 'u1', partIndex: 1 })
        expect(fork.messages[0].parts).toEqual([{ type: 'text', text: 'one' }])
    expect(source.messages[0].parts).toHaveLength(2)
    })

    test('fork failure repairs the workspace index', async () => {
        const workspace = await Workspace.add(process.env.AGENT_HOME)
        const source = await Session.create(workspace.id, 'openai', 'model')
        await Session.append(source.id, { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'one' }] })
        const save = Store.save
        let fail = true
        Store.save = async domain => {
            if (domain === 'workspaces' && fail) { fail = false; throw new Error('workspace save failed') }
            return save(domain)
        }
        await expect(Fork.create(source.id, { messageID: 'u1', partIndex: 0 })).rejects.toThrow('workspace save failed')
        Store.save = save
        expect(workspace.sessions).toHaveLength(1)
        Store.workspaces = {}; Store.sessions = {}; Store.runtimes = {}
        await Store.load()
        expect(Store.workspaces[workspace.id].sessions).toHaveLength(1)
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
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'missing', 'missing')
    await Promise.all([Agent.send(session.id, 'first'), Agent.send(session.id, 'second')])
    await Bun.sleep(20)
    expect(session.messages.filter(message => message.role === 'user').map(message => message.parts[0].text)).toEqual(['first', 'second'])
    expect(Store.runtimes[session.id].status).toBe('idle')
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
    Store.config.providers = [{ name: 'mock', baseURL: `http://127.0.0.1:${model.port}/v1`, key: 'test', models: [{ id: 'model', contextWindow: 1000, maxOutput: 100 }] }]
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'mock', 'model')
    await Session.append(session.id, { id: 'prompt', role: 'user', parts: [{ type: 'text', text: 'summarize' }] })
    const compact = Compact.run(session.id)
    await Bun.sleep(20)
    expect(await Agent.stop(session.id)).toBe(true)
    await compact.catch(() => {})
    model.stop()
    expect(aborted || Store.runtimes[session.id].status === 'idle').toBe(true)
    expect(Store.runtimes[session.id].status).toBe('idle')
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

test('startup recovery finishes a prepared rollback', async () => {
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'missing', 'missing')
    const path = join(process.env.AGENT_HOME, 'recover.txt')
    await Bun.write(path, 'before')
    await Session.append(session.id, { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'request' }] })
    await Session.append(session.id, { id: 'a1', role: 'assistant', parts: [{ type: 'tool-file_write', toolCallId: 'call', state: 'input-available', input: {} }] })
    await Checkpoint.save(session.id, { messageID: 'a1', partIndex: 0 }, path)
    await Bun.write(path, 'after')
    await Session.append(session.id, { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'later' }] })

    const log = (await readFile(Path.undoLog(session.id), 'utf8')).trim().split('\n').map(JSON.parse)
    const snapshot = join(Path.undo(session.id), 'recover-snapshot')
    await Bun.write(snapshot, 'after')
    await Bun.write(Path.undoLog(session.id), `${JSON.stringify({
        type: 'rollback', state: 'prepared', sequence: 'recover',
        position: { messageID: 'a1', partIndex: 0 }, messages: structuredClone(session.messages),
        files: [{ path, existed: true, snapshot }],
        removed: log.filter(item => item.type === 'write'),
    })}\n`)

    expect(await recover(session.id)).toBe(true)
    expect(await Bun.file(path).text()).toBe('before')
    expect(session.messages.map(message => message.id)).toEqual(['u1'])
})

test('failed rollback remains recoverable from its prepared record', async () => {
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'missing', 'missing')
    const path = join(process.env.AGENT_HOME, 'rollback-failure.txt')
    await Bun.write(path, 'before')
    await Session.append(session.id, { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'request' }] })
    await Session.append(session.id, { id: 'a1', role: 'assistant', parts: [{ type: 'tool-file_write', toolCallId: 'call', state: 'input-available', input: {} }] })
    await Checkpoint.save(session.id, { messageID: 'a1', partIndex: 0 }, path)
    await Bun.write(path, 'after')
    await Session.append(session.id, { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'later' }] })
    const exact = structuredClone(session.messages)
    const save = Store.save
    Store.save = async domain => { if (domain === session.id) throw new Error('simulated save failure'); return save(domain) }
    await expect(Checkpoint.rollback(session.id, { messageID: 'a1', partIndex: 0 })).rejects.toThrow('simulated save failure')
    Store.save = save
    expect(await Bun.file(path).text()).toBe('before')
    expect((await readFile(Path.undoLog(session.id), 'utf8')).includes('"state":"prepared"')).toBe(true)
    await recover(session.id)
    expect(await Bun.file(path).text()).toBe('before')
    expect(session.messages.map(message => message.id)).toEqual(['u1'])
    expect(await recover(session.id)).toBe(false)
})

test('failed undo remains resumable from its prepared record', async () => {
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'missing', 'missing')
    const path = join(process.env.AGENT_HOME, 'undo-failure.txt')
    await Bun.write(path, 'before')
    await Session.append(session.id, { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'request' }] })
    await Session.append(session.id, { id: 'a1', role: 'assistant', parts: [{ type: 'tool-file_write', toolCallId: 'call', state: 'input-available', input: {} }] })
    await Checkpoint.save(session.id, { messageID: 'a1', partIndex: 0 }, path)
    await Bun.write(path, 'after')
    await Session.append(session.id, { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'later' }] })
    await Checkpoint.rollback(session.id, { messageID: 'a1', partIndex: 0 })
    const save = Store.save
    Store.save = async domain => { if (domain === session.id) throw new Error('undo save failure'); return save(domain) }
    await expect(Checkpoint.undo(session.id)).rejects.toThrow('undo save failure')
    Store.save = save
    expect((await readFile(Path.undoLog(session.id), 'utf8')).includes('"type":"undo"')).toBe(true)
    expect(await recover(session.id)).toBe(true)
    expect(await Bun.file(path).text()).toBe('after')
    expect(session.messages.map(message => message.id)).toEqual(['u1', 'a1', 'u2'])
    expect((await readFile(Path.undoLog(session.id), 'utf8')).includes('"type":"undo"')).toBe(false)
    expect(await recover(session.id)).toBe(false)
})

test('remove waits for queued append before deleting the session', async () => {
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'missing', 'missing')
    const append = Session.append(session.id, { id: 'queued', role: 'user', parts: [{ type: 'text', text: 'queued' }] })
    const remove = Session.remove(session.id)
    await Promise.all([append, remove])
    expect(Store.sessions[session.id]).toBeUndefined()
    expect(await Bun.file(Path.messages(session.id)).exists()).toBe(false)
    await expect(Session.update(session.id, { title: 'late' })).rejects.toThrow('Session not found')
    await expect(Session.append(session.id, { id: 'late', role: 'user', parts: [] })).rejects.toThrow('Session not found')
})

test('remove waits for a rollback persistence task', async () => {
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'missing', 'missing')
    const path = join(process.env.AGENT_HOME, 'remove-checkpoint.txt')
    await Bun.write(path, 'before')
    await Session.append(session.id, { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'request' }] })
    await Session.append(session.id, { id: 'a1', role: 'assistant', parts: [{ type: 'tool-file_write', toolCallId: 'call', state: 'input-available', input: {} }] })
    await Checkpoint.save(session.id, { messageID: 'a1', partIndex: 0 }, path)
    await Bun.write(path, 'after')
    await Session.append(session.id, { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'later' }] })
    let release
    let entered
    const wait = new Promise(resolve => { release = resolve })
    const started = new Promise(resolve => { entered = resolve })
    const save = Store.save
    let blocked = true
    Store.save = async domain => {
        if (domain === session.id && blocked) { blocked = false; entered(); await wait }
        return save(domain)
    }
    const rollback = Checkpoint.rollback(session.id, { messageID: 'a1', partIndex: 0 })
    await started
    const remove = Session.remove(session.id)
    release()
    const [rolled, deleted] = await Promise.allSettled([rollback, remove])
    Store.save = save
    expect(rolled.status).toBe('fulfilled')
    expect(deleted.status).toBe('fulfilled')
    expect(Store.sessions[session.id]).toBeUndefined()
})

test('remove stops a running session before taking its write queue', async () => {
    const model = Bun.serve({ port: 0, fetch: request => new Promise(resolve => request.signal.addEventListener('abort', () => resolve(new Response('', { status: 499 })), { once: true })) })
    Store.config.providers = [{ name: 'mock', baseURL: `http://127.0.0.1:${model.port}/v1`, key: 'test', models: [{ id: 'model', contextWindow: 1000, maxOutput: 100 }] }]
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'mock', 'model')
    await Agent.send(session.id, 'run until stopped')
    await Bun.sleep(20)
    expect(await Session.remove(session.id)).toBe(true)
    model.stop()
})

test('concurrent send and remove resolve without touching deleted state', async () => {
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'missing', 'missing')
    const send = Agent.send(session.id, 'race')
    const remove = Session.remove(session.id)
    const [sent, deleted] = await Promise.allSettled([send, remove])
    expect(deleted.status).toBe('fulfilled')
    expect(Store.sessions[session.id]).toBeUndefined()
    if (sent.status === 'rejected') expect(String(sent.reason)).toContain('Session')
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
