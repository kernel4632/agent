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
})

test('permission waits for and applies an allow-once decision', async () => {
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'openai', 'model')
    const pending = Permission.request(session.id, 'call-1', 'shell', { command: 'pwd' })
    await Bun.sleep(0)
    expect(await Permission.decide(session.id, 'call-1', 'allow', 'once')).toBe(true)
    expect(await pending).toBe(true)
})
