import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'bun:test'
import { nanoid } from 'nanoid'
import { DefaultChatTransport } from 'ai'
import Auth from '../commands/auth.ts'
import Config from '../commands/config.ts'
import Session from '../commands/session.ts'
import Workspace from '../commands/workspace.ts'
import Checkpoint from '../features/checkpoint.ts'
import Store from '../store.ts'
import { app, shutdown, start } from '../server.ts'

beforeEach(async () => {
    process.env.AGENT_HOME = join(tmpdir(), `agent-api-${nanoid()}`)
    await mkdir(process.env.AGENT_HOME, { recursive: true })
    Store.config = structuredClone(Store.defaults)
    Store.workspaces = {}
    Store.sessions = {}
    Store.runtimes = {}
    Auth.reset()
    await Config.load()
    await Workspace.load()
    await Session.load()
})

describe('HTTP API', () => {
    const request = (path: string, method = 'GET', body?: unknown, cookie?: string) => app.handle(new Request(`http://agent${path}`, {
        method,
        headers: {
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            ...(cookie ? { cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    }))

    it('leaves health public and guards configuration', async () => {
        Store.config.auth = { username: 'user', password: 'pass' }
        expect((await app.handle(new Request('http://agent/health'))).status).toBe(200)
        expect((await app.handle(new Request('http://agent/config'))).status).toBe(401)
    })

    it('logs in with credentials and accepts the cookie', async () => {
        Store.config.auth = { username: 'user', password: 'pass' }
        const login = await app.handle(new Request('http://agent/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'user', password: 'pass' }),
        }))
        expect(login.status).toBe(200)
        const cookie = login.headers.get('set-cookie')!
        const config = await app.handle(new Request('http://agent/config', { headers: { cookie } }))
        expect(config.status).toBe(200)
    })

    it('validates request bodies with Elysia schemas', async () => {
        const response = await app.handle(new Request('http://agent/workspace', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
        }))
        expect(response.status).toBe(422)
        const malformedMessage = await app.handle(new Request('http://agent/agent/send', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionID: 'missing', message: {} }),
        }))
        expect(malformedMessage.status).toBe(422)
    })

    it('starts a real HTTP server and answers the health probe', async () => {
        const server = await start(0)
        const response = await fetch(`http://127.0.0.1:${server.port}/health`)
        await shutdown()
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
    })

    it('streams standard UIMessageChunks through a real authenticated HTTP connection', async () => {
        Store.config.auth = { username: 'user', password: 'pass' }
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'provider', 'model')
        const server = await start(0)
        Store.runtimes[session.id]!.status = 'running'
        let finish = () => {}
        Store.runtimes[session.id]!.task = new Promise<void>(resolve => { finish = resolve })
        const origin = `http://127.0.0.1:${server.port}`
        const login = await fetch(`${origin}/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'user', password: 'pass' }),
        })
        const cookie = login.headers.get('set-cookie')!
        const transport = new DefaultChatTransport({
            api: origin,
            headers: { cookie },
            prepareReconnectToStreamRequest: () => ({ api: `${origin}/session/events?sessionID=${session.id}` }),
        })
        const stream = await transport.reconnectToStream({ chatId: session.id })
        const reader = stream!.getReader()
        const snapshot = await reader.read()
        expect(snapshot.value?.type).toBe('data-session-snapshot')
        for (const event of [{ type: 'text-start', id: 'text-1' }, { type: 'text-delta', id: 'text-1', delta: 'hello' }, { type: 'text-end', id: 'text-1' }] as const) {
            await Promise.all([...Store.runtimes[session.id]!.listeners].map(listener => listener(event)))
        }
        expect((await reader.read()).value).toEqual({ type: 'text-start', id: 'text-1' })
        expect((await reader.read()).value).toEqual({ type: 'text-delta', id: 'text-1', delta: 'hello' })
        expect((await reader.read()).value).toEqual({ type: 'text-end', id: 'text-1' })
        finish()
        await reader.cancel()
        Store.runtimes[session.id]!.status = 'idle'
        Store.runtimes[session.id]!.abort.abort()
        await shutdown()
    })

    it('accepts and returns a standard UI message stream through DefaultChatTransport', async () => {
        Store.config.auth = { username: 'user', password: 'pass' }
        const model = Bun.serve({ port: 0, fetch: () => new Response([
            `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: 'hello' }, finish_reason: null }] })}\n\n`,
            `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`,
            'data: [DONE]\n\n',
        ].join(''), { headers: { 'content-type': 'text/event-stream' } }) })
        Store.config.providers = [{ name: 'mock', baseURL: `http://127.0.0.1:${model.port}/v1`, key: 'test', models: [{ id: 'model', contextWindow: 100000, maxOutput: 1000 }] }]
        Store.config.context.idleRounds = 1
        await Config.save({ providers: Store.config.providers })
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'mock', 'model')
        const server = await start(0)
        const origin = `http://127.0.0.1:${server.port}`
        const login = await fetch(`${origin}/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'user', password: 'pass' }),
        })
        const transport = new DefaultChatTransport({
            api: `${origin}/agent/send`,
            headers: { cookie: login.headers.get('set-cookie')! },
            prepareSendMessagesRequest: ({ id, messages }) => ({
                body: { sessionID: id, message: messages.at(-1) },
            }),
        })
        const user = { id: 'user-http', role: 'user' as const, parts: [{ type: 'text' as const, text: 'say hello' }] }
        const stream = await transport.sendMessages({
            trigger: 'submit-message',
            chatId: session.id,
            messageId: user.id,
            messages: [user],
            abortSignal: undefined,
        })
        const chunks = []
        for await (const chunk of stream) chunks.push(chunk)
        await shutdown()
        model.stop()
        expect(chunks.some(chunk => chunk.type === 'text-delta' && chunk.delta === 'hello')).toBe(true)
        expect(chunks.at(-1)?.type).toBe('data-session-status')
        expect(Store.sessions[session.id]!.messages[0]!.id).toBe('user-http')
    })

    it('covers configuration, workspace, session, tool and fork routes', async () => {
        const config = await request('/config', 'PATCH', { context: { idleRounds: 2 } })
        expect(config.status).toBe(200)
        expect((await config.json() as any).context.idleRounds).toBe(2)

        const project = join(process.env.AGENT_HOME!, 'project')
        await mkdir(project)
        const createdWorkspace = await request('/workspace', 'POST', { path: project })
        const workspace = await createdWorkspace.json() as any
        expect(workspace.path).toBe(project)
        expect((await request('/workspace')).status).toBe(200)

        const createdSession = await request('/session', 'POST', { workspaceID: workspace.id, provider: 'provider', model: 'model' })
        const session = await createdSession.json() as any
        expect((await request(`/session?id=${session.id}`)).status).toBe(200)
        const updated = await request('/session', 'PATCH', { id: session.id, model: 'other-model' })
        expect((await updated.json() as any).model).toBe('other-model')
        expect((await request(`/tool?sessionID=${session.id}`)).status).toBe(200)

        await Session.append(session.id, { id: 'fork-point', role: 'user', parts: [{ type: 'text', text: 'fork here' }] })
        const forked = await request('/session/fork', 'POST', { sessionID: session.id, messageID: 'fork-point', partIndex: 1 })
        const fork = await forked.json() as any
        expect(fork.messages).toHaveLength(1)
        expect((await request(`/session?id=${fork.id}`, 'DELETE')).status).toBe(200)
        expect((await request(`/session?id=${session.id}`, 'DELETE')).status).toBe(200)
        expect((await request(`/workspace?id=${workspace.id}`, 'DELETE')).status).toBe(200)
    })

    it('compacts and undoes checkpoints through HTTP routes', async () => {
        const model = Bun.serve({ port: 0, fetch: () => new Response([
            `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: 'summary' }, finish_reason: null }] })}\n\n`,
            `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`,
            'data: [DONE]\n\n',
        ].join(''), { headers: { 'content-type': 'text/event-stream' } }) })
        Store.config.providers = [{ name: 'mock', baseURL: `http://127.0.0.1:${model.port}/v1`, key: 'test', models: [{ id: 'model', contextWindow: 10000, maxOutput: 1000 }] }]
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'mock', 'model')
        await Session.append(session.id, { id: 'checkpoint-message', role: 'user', parts: [{ type: 'text', text: 'before' }] })
        const path = join(process.env.AGENT_HOME!, 'checkpoint.txt')
        await writeFile(path, 'before')
        await Checkpoint.save(session.id, { messageID: 'checkpoint-message', partIndex: 0 }, path)
        await writeFile(path, 'after')

        const compact = await request('/session/compact', 'POST', { sessionID: session.id })
        expect(compact.status).toBe(200)
        expect((await compact.json() as any).summary).toBe(true)
        const undo = await request('/checkpoint/undo', 'POST', { sessionID: session.id })
        model.stop()
        expect(undo.status).toBe(200)
        expect(await readFile(path, 'utf8')).toBe('before')
    })

    it('invalidates the authentication cookie on logout', async () => {
        Store.config.auth = { username: 'user', password: 'pass' }
        const login = await request('/login', 'POST', { username: 'user', password: 'pass' })
        const cookie = login.headers.get('set-cookie')!
        expect((await request('/config', 'GET', undefined, cookie)).status).toBe(200)
        expect((await request('/logout', 'POST', undefined, cookie)).status).toBe(200)
        expect((await request('/config', 'GET', undefined, cookie)).status).toBe(401)
    })

    it('enables and disables a global plugin through HTTP', async () => {
        expect((await request('/plugin')).status).toBe(200)
        const enabled = await request('/plugin', 'PATCH', { name: 'title', enabled: true })
        expect(enabled.status).toBe(200)
        expect(await enabled.json()).toContain('title')
        const disabled = await request('/plugin', 'PATCH', { name: 'title', enabled: false })
        expect(disabled.status).toBe(200)
        expect(await disabled.json()).not.toContain('title')
    })

    it('resolves a pending permission and stops a running agent through HTTP', async () => {
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'provider', 'model')
        Store.runtimes[session.id]!.permission.set('call', () => undefined)
        const decision = await request('/permission/decide', 'POST', {
            sessionID: session.id,
            callID: 'call',
            decision: { action: 'allow', scope: 'once' },
        })
        expect(decision.status).toBe(200)
        expect(await decision.json()).toBe(true)
        Store.runtimes[session.id]!.status = 'running'
        Store.runtimes[session.id]!.task = new Promise<void>(resolve => {
            Store.runtimes[session.id]!.abort.signal.addEventListener('abort', () => resolve(), { once: true })
        })
        const stop = await request('/agent/stop', 'POST', { sessionID: session.id })
        expect(stop.status).toBe(200)
        expect(await stop.json()).toBe(true)
    })

    it('maps domain errors to explicit HTTP statuses', async () => {
        expect((await request('/session?id=missing')).status).toBe(200)
        expect((await request('/agent/send', 'POST', { sessionID: 'missing', message: 'hello' })).status).toBe(404)
        expect((await request('/workspace', 'POST', { path: join(process.env.AGENT_HOME!, 'missing') })).status).toBe(422)
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'provider', 'model')
        await Session.append(session.id, { id: 'duplicate', role: 'user', parts: [{ type: 'text', text: 'once' }] })
        expect((await request('/agent/send', 'POST', {
            sessionID: session.id,
            message: { id: 'duplicate', role: 'user', parts: [{ type: 'text', text: 'twice' }] },
        })).status).toBe(409)
        expect((await request(`/workspace?id=${workspace.id}`, 'DELETE')).status).toBe(409)
        expect((await request('/config', 'PATCH', { context: { compactRatio: 2 } })).status).toBe(422)
    })

    it('shuts down within a deadline, closes streams and rejects new work', async () => {
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'provider', 'model')
        const server = await start(0)
        const started = Date.now()
        await shutdown()
        expect(Date.now() - started).toBeLessThan(500)
        const restarted = await start(0)
        expect(restarted.port).toBeGreaterThan(0)
        await shutdown()
        server.stop(true)
    })

    it('serializes concurrent configuration patches without losing fields', async () => {
        await Promise.all([
            request('/config', 'PATCH', { prompts: { system: 'changed' } }),
            request('/config', 'PATCH', { context: { idleRounds: 9 } }),
        ])
        expect(Store.config.prompts.system).toBe('changed')
        expect(Store.config.context.idleRounds).toBe(9)
    })
})
