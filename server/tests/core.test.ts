import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'bun:test'
import { nanoid } from 'nanoid'
import Agent from '../commands/agent.ts'
import Auth from '../commands/auth.ts'
import Config from '../commands/config.ts'
import Session from '../commands/session.ts'
import Workspace from '../commands/workspace.ts'
import Checkpoint from '../features/checkpoint.ts'
import Compact from '../features/compact.ts'
import Context from '../features/context.ts'
import Fork from '../features/fork.ts'
import Permission from '../features/permission.ts'
import Plugin from '../features/plugin.ts'
import Path from '../utils/path.ts'
import Store from '../store.ts'

beforeEach(async () => {
    process.env.AGENT_HOME = join(tmpdir(), `agent-test-${nanoid()}`)
    Auth.reset()
    await mkdir(process.env.AGENT_HOME, { recursive: true })
    Store.config = structuredClone(Store.defaults)
    Store.workspaces = {}
    Store.sessions = {}
    Store.runtimes = {}
    await Config.load()
    await Workspace.load()
    await Session.load()
})

describe('Store', () => {
    it('keeps configuration arrays replaceable during patch', async () => {
        await Config.save({ permission: [{ tool: 'shell', match: '*', action: 'allow' }] })
        expect(Store.config.permission).toEqual([{ tool: 'shell', match: '*', action: 'allow' }])
    })

    it('rejects damaged JSONL lines instead of silently losing messages', async () => {
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'provider', 'model')
        await writeFile(Path.messages(session.id), '{"id":"ok"}\nnot-json\n')
        Store.sessions = {}
        Store.runtimes = {}
        await expect(Session.load()).rejects.toThrow('Invalid JSONL')
    })

    it('rejects an incomplete trailing JSONL record without overwriting it', async () => {
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'provider', 'model')
        await writeFile(Path.messages(session.id), '{"id":"ok","role":"user","parts":[]}\n{"id":"partial"')
        Store.sessions = {}
        Store.runtimes = {}
        await expect(Session.load()).rejects.toThrow('Invalid JSONL')
        expect(await readFile(Path.messages(session.id), 'utf8')).toContain('partial')
    })

    it('validates config before committing and protects persisted files', async () => {
        await expect(Config.save({ context: { compactRatio: 2 } } as any)).rejects.toThrow()
        expect(Store.config.context.compactRatio).toBe(0.8)
        expect((await stat(Path.config())).mode & 0o777).toBe(0o600)
        expect((await stat(Path.workspaces())).mode & 0o777).toBe(0o600)
        expect((await stat(Path.root())).mode & 0o777).toBe(0o700)
    })

    it('does not overwrite invalid persisted configuration', async () => {
        await writeFile(Path.config(), '{invalid')
        await expect(Config.load()).rejects.toThrow('Invalid JSON')
        expect(await readFile(Path.config(), 'utf8')).toBe('{invalid')
    })
})

describe('Permission', () => {
    it('waits until a decision and persists an always-allow rule', async () => {
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'provider', 'model')
        const pending = Permission.request(session.id, 'call', 'shell', { command: 'ls' })
        await Bun.sleep(1)
        expect(Store.runtimes[session.id]!.permission.has('call')).toBe(true)
        Permission.decide(session.id, 'call', { action: 'allow', scope: 'always' })
        expect(await pending).toBe(true)
        expect(Store.config.permission.at(-1)?.action).toBe('allow')
    })
})

describe('Checkpoint', () => {
    it('restores overwritten and newly created files at a part position', async () => {
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'provider', 'model')
        const path = join(workspace.path, 'value.txt')
        await writeFile(path, 'before')
        const message = { id: nanoid(), role: 'assistant' as const, parts: [{ type: 'text' as const, text: 'tool' }] }
        await Session.append(session.id, message)
        await Checkpoint.save(session.id, { messageID: message.id, partIndex: 0 }, path)
        await writeFile(path, 'after')
        await Checkpoint.rollback(session.id, { messageID: message.id, partIndex: 0 })
        expect(await readFile(path, 'utf8')).toBe('before')
        expect(Store.sessions[session.id]!.messages).toHaveLength(0)
    })

    it('rejects an invalid position before changing files or checkpoints', async () => {
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'provider', 'model')
        const path = join(workspace.path, 'value.txt')
        await writeFile(path, 'before')
        const message = { id: nanoid(), role: 'assistant' as const, parts: [{ type: 'text' as const, text: 'tool' }] }
        await Session.append(session.id, message)
        await Checkpoint.save(session.id, { messageID: message.id, partIndex: 0 }, path)
        await writeFile(path, 'after')
        await expect(Checkpoint.rollback(session.id, { messageID: 'missing', partIndex: 0 })).rejects.toThrow('Message not found')
        expect(await readFile(path, 'utf8')).toBe('after')
        expect(await Checkpoint.list(session.id)).toHaveLength(1)
    })

    it('keeps checkpoint JSONL valid after rollback followed by another save', async () => {
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'provider', 'model')
        const path = join(workspace.path, 'value.txt')
        await writeFile(path, 'zero')
        const first = { id: 'first', role: 'assistant' as const, parts: [{ type: 'text' as const, text: 'first' }] }
        const second = { id: 'second', role: 'assistant' as const, parts: [{ type: 'text' as const, text: 'second' }] }
        await Session.append(session.id, first)
        await Checkpoint.save(session.id, { messageID: first.id, partIndex: 0 }, path)
        await writeFile(path, 'one')
        await Session.append(session.id, second)
        await Checkpoint.save(session.id, { messageID: second.id, partIndex: 0 }, path)
        await writeFile(path, 'two')
        await Checkpoint.rollback(session.id, { messageID: second.id, partIndex: 0 })
        const third = { id: 'third', role: 'assistant' as const, parts: [{ type: 'text' as const, text: 'third' }] }
        await Session.append(session.id, third)
        await Checkpoint.save(session.id, { messageID: third.id, partIndex: 0 }, path)
        expect((await Checkpoint.list(session.id)).map(entry => entry.messageID)).toEqual(['first', 'third'])
    })

    it('replays an interrupted rollback intent during startup', async () => {
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'provider', 'model')
        const path = join(workspace.path, 'recover.txt')
        await writeFile(path, 'before')
        const message = { id: 'recover-message', role: 'assistant' as const, parts: [{ type: 'text' as const, text: 'tool' }] }
        await Session.append(session.id, message)
        const entry = await Checkpoint.save(session.id, { messageID: message.id, partIndex: 0 }, path)
        await writeFile(path, 'after')
        await writeFile(Path.rollback(session.id), JSON.stringify({ position: { messageID: message.id, partIndex: 0 }, reverting: [entry] }))
        Store.sessions = {}
        Store.runtimes = {}
        await Session.load()
        await Checkpoint.recover(session.id)
        expect(await readFile(path, 'utf8')).toBe('before')
        expect(Store.sessions[session.id]!.messages).toHaveLength(0)
        expect(await Checkpoint.list(session.id)).toHaveLength(0)
        expect(await Bun.file(Path.rollback(session.id)).exists()).toBe(false)
    })
})

describe('Context', () => {
    it('keeps the first three, latest summary neighborhood, summary and tail', () => {
        const messages = Array.from({ length: 15 }, (_, index) => ({
            id: String(index),
            role: 'user' as const,
            parts: [{ type: 'text' as const, text: String(index) }],
            ...(index === 10 ? { summary: true as const } : {}),
        }))
        expect(Context.select(messages).map(message => message.id)).toEqual(['0', '1', '2', '7', '8', '9', '10', '11', '12', '13', '14'])
    })

    it('appends a real summary without deleting history and supports forking from a part', async () => {
        const model = Bun.serve({ port: 0, fetch: () => new Response([
            `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: 'summary' }, finish_reason: null }] })}\n\n`,
            `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } })}\n\n`,
            'data: [DONE]\n\n',
        ].join(''), { headers: { 'content-type': 'text/event-stream' } }) })
        Store.config.providers = [{ name: 'mock', baseURL: `http://127.0.0.1:${model.port}/v1`, key: 'test', models: [{ id: 'model', contextWindow: 1000, maxOutput: 100 }] }]
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'mock', 'model')
        for (let index = 0; index < 5; index += 1) await Session.append(session.id, {
            id: `message-${index}`,
            role: 'user',
            parts: [{ type: 'text', text: String(index) }],
        })
        const summary = await Compact.run(session.id)
        expect(summary.summary).toBe(true)
        expect(Store.sessions[session.id]!.messages).toHaveLength(6)
        const fork = await Fork.create(session.id, { messageID: 'message-3', partIndex: 1 })
        model.stop()
        expect(fork.messages.map(message => message.id)).toEqual(['message-0', 'message-1', 'message-2', 'message-3'])
        Store.sessions = {}
        Store.runtimes = {}
        await Session.load()
        expect(Store.sessions[session.id]!.messages).toHaveLength(6)
        expect(Store.sessions[fork.id]!.messages).toHaveLength(4)
    })

    it('ignores orphaned incomplete tool calls when rebuilding model context', async () => {
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'provider', 'model')
        session.messages.push(
            { id: 'user-before', role: 'user', parts: [{ type: 'text', text: 'before' }] },
            { id: 'orphan', role: 'assistant', parts: [{ type: 'dynamic-tool', toolName: 'finish', toolCallId: 'orphan-call', state: 'input-available', input: { result: 'lost' } } as any] },
            { id: 'user-after', role: 'user', parts: [{ type: 'text', text: 'after' }] },
        )
        const context = await Context.build(session.id, {})
        expect(JSON.stringify(context)).not.toContain('orphan-call')
        expect(JSON.stringify(context)).toContain('after')
    })
})

describe('Lifecycle', () => {
    it('does not remove a workspace while it owns sessions', async () => {
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        await Session.create(workspace.id, 'provider', 'model')
        await expect(Workspace.remove(workspace.id)).rejects.toThrow('Cannot remove a workspace with sessions')
    })
})

describe('Agent API surface', () => {
    it('exposes only send and stop as agent commands', () => {
        expect(Object.keys(Agent).sort()).toEqual(['send', 'stop'])
    })

    it('exposes only the two agent actions to plugins', () => {
        expect(typeof Plugin.setAPI).toBe('function')
        expect(typeof Plugin.emit).toBe('function')
    })
})
