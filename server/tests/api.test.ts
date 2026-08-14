import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'bun:test'
import { nanoid } from 'nanoid'
import { DefaultChatTransport, type UIMessageChunk } from 'ai'
import Auth from '../commands/auth.ts'
import Agent from '../commands/agent.ts'
import Config from '../commands/config.ts'
import Session from '../commands/session.ts'
import Workspace from '../commands/workspace.ts'
import Checkpoint from '../features/checkpoint.ts'
import Plugin from '../features/plugin.ts'
import Store from '../store.ts'
import { app, shutdown, start } from '../server.ts'
import Path from '../utils/path.ts'

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
        await Config.save({ auth: { username: 'user', password: 'pass' } })
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'provider', 'model')
        const server = await start(0)
        Store.runtimes[session.id]!.status = 'running'
        let finish = () => {}
        Store.runtimes[session.id]!.task = new Promise<void>(resolve => { finish = resolve })
        Store.runtimes[session.id]!.events = [{ type: 'text-start', id: 'text-1' }, { type: 'text-delta', id: 'text-1', delta: 'hello' }]
        const origin = `http://127.0.0.1:${server.port}`
        expect((await fetch(`${origin}/config`)).status).toBe(401)
        const login = await fetch(`${origin}/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'user', password: 'pass' }),
        })
        expect(login.status).toBe(200)
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
        expect((await reader.read()).value).toEqual({ type: 'text-start', id: 'text-1' })
        expect((await reader.read()).value).toEqual({ type: 'text-delta', id: 'text-1', delta: 'hello' })
        await Promise.all([...Store.runtimes[session.id]!.listeners].map(listener => listener({ type: 'text-end', id: 'text-1' })))
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
        const chunks: UIMessageChunk[] = []
        for await (const chunk of stream) chunks.push(chunk)
        const second = { id: 'user-http-2', role: 'user' as const, parts: [{ type: 'text' as const, text: 'say hello again' }] }
        const secondStream = await transport.sendMessages({
            trigger: 'submit-message', chatId: session.id, messageId: second.id, messages: [user, second], abortSignal: undefined,
        })
        const secondChunks = []
        for await (const chunk of secondStream) secondChunks.push(chunk)
        await shutdown()
        model.stop()
        expect(chunks.some(chunk => chunk.type === 'text-delta' && chunk.delta === 'hello')).toBe(true)
        expect(chunks.at(-1)?.type).toBe('data-session-status')
        expect(secondChunks.some(chunk => chunk.type === 'text-delta' && chunk.delta === 'hello')).toBe(true)
        expect(secondChunks.at(-1)?.type).toBe('data-session-status')
        expect(Store.sessions[session.id]!.messages[0]!.id).toBe('user-http')
    })

    it('keeps an overlapping second send isolated from the first task idle event', async () => {
        let calls = 0
        const response = () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: 'second' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
        const model = Bun.serve({ port: 0, fetch: request => {
            calls += 1
            if (calls > 1) return response()
            return new Promise(resolve => {
                const timer = setTimeout(() => resolve(response()), 200)
                request.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(new Response('', { status: 499 })) }, { once: true })
            })
        } })
        Store.config.providers = [{ name: 'mock', baseURL: `http://127.0.0.1:${model.port}/v1`, key: 'test', models: [{ id: 'model', contextWindow: 100000, maxOutput: 1000 }] }]
        Store.config.context.idleRounds = 1
        await Config.save({ providers: Store.config.providers, context: Store.config.context })
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'mock', 'model')
        const server = await start(0)
        const transport = new DefaultChatTransport({
            api: `http://127.0.0.1:${server.port}/agent/send`,
            prepareSendMessagesRequest: ({ id, messages }) => ({ body: { sessionID: id, message: messages.at(-1) } }),
        })
        const first = { id: 'overlap-1', role: 'user' as const, parts: [{ type: 'text' as const, text: 'first' }] }
        const firstStream = await transport.sendMessages({ trigger: 'submit-message', chatId: session.id, messageId: first.id, messages: [first], abortSignal: undefined })
        const firstDone = (async () => { for await (const _chunk of firstStream) { /* consume */ } })()
        while (calls < 1) await Bun.sleep(1)
        const second = { id: 'overlap-2', role: 'user' as const, parts: [{ type: 'text' as const, text: 'second' }] }
        const secondStream = await transport.sendMessages({ trigger: 'submit-message', chatId: session.id, messageId: second.id, messages: [first, second], abortSignal: undefined })
        const chunks = []
        for await (const chunk of secondStream) chunks.push(chunk)
        await firstDone
        await shutdown()
        model.stop()
        expect(chunks.some(chunk => chunk.type === 'text-delta' && chunk.delta === 'second')).toBe(true)
        expect(chunks.at(-1)?.type).toBe('data-session-status')
    })

    it('keeps the agent running when the original send stream disconnects', async () => {
        const model = Bun.serve({ port: 0, fetch: async () => {
            await Bun.sleep(50)
            const call = { index: 0, id: 'finish-disconnected', type: 'function', function: { name: 'finish', arguments: '{"result":"completed"}' } }
            return new Response(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', tool_calls: [call] }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
        } })
        Store.config.providers = [{ name: 'mock', baseURL: `http://127.0.0.1:${model.port}/v1`, key: 'test', models: [{ id: 'model', contextWindow: 100000, maxOutput: 1000 }] }]
        Store.config.permission = [{ tool: '*', match: '*', action: 'allow' }]
        await Config.save({ providers: Store.config.providers, permission: Store.config.permission })
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'mock', 'model')
        const server = await start(0)
        const response = await fetch(`http://127.0.0.1:${server.port}/agent/send`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionID: session.id, message: 'disconnect' }),
        })
        const reader = response.body!.getReader()
        await reader.read()
        await reader.cancel()
        await Store.runtimes[session.id]!.task
        const reconnect = new DefaultChatTransport({ api: `http://127.0.0.1:${server.port}`, prepareReconnectToStreamRequest: () => ({ api: `http://127.0.0.1:${server.port}/session/events?sessionID=${session.id}` }) })
        const recovered = await reconnect.reconnectToStream({ chatId: session.id })
        const chunks: UIMessageChunk[] = []
        for await (const chunk of recovered!) chunks.push(chunk)
        await shutdown()
        model.stop()
        expect(Store.sessions[session.id]!.messages.some(message => message.role === 'assistant')).toBe(true)
        expect(Store.runtimes[session.id]!.status).toBe('idle')
        expect(JSON.stringify(chunks[0])).toContain('assistant')
    })

    it('streams permission request and resolution through the original send', async () => {
        let calls = 0
        const model = Bun.serve({ port: 0, fetch: () => {
            calls += 1
            const call = calls === 1
                ? { index: 0, id: 'permission-http', type: 'function', function: { name: 'file_list', arguments: JSON.stringify({ path: process.env.AGENT_HOME }) } }
                : { index: 0, id: 'finish-permission-http', type: 'function', function: { name: 'finish', arguments: '{"result":"done"}' } }
            return new Response(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', tool_calls: [call] }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
        } })
        Store.config.providers = [{ name: 'mock', baseURL: `http://127.0.0.1:${model.port}/v1`, key: 'test', models: [{ id: 'model', contextWindow: 100000, maxOutput: 1000 }] }]
        Store.config.permission = [{ tool: '*', match: '*', action: 'ask' }, { tool: 'finish', match: '*', action: 'allow' }]
        await Config.save({ providers: Store.config.providers, permission: Store.config.permission })
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'mock', 'model')
        const server = await start(0)
        const origin = `http://127.0.0.1:${server.port}`
        const transport = new DefaultChatTransport({ api: `${origin}/agent/send`, prepareSendMessagesRequest: ({ id, messages }) => ({ body: { sessionID: id, message: messages.at(-1) } }) })
        const user = { id: 'permission-user', role: 'user' as const, parts: [{ type: 'text' as const, text: 'list files' }] }
        const stream = await transport.sendMessages({ trigger: 'submit-message', chatId: session.id, messageId: user.id, messages: [user], abortSignal: undefined })
        const chunks: UIMessageChunk[] = []
        const collecting = (async () => { for await (const chunk of stream) chunks.push(chunk) })()
        while (!Store.runtimes[session.id]!.permission.has('permission-http')) await Bun.sleep(1)
        const decision = await fetch(`${origin}/permission/decide`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionID: session.id, callID: 'permission-http', decision: { action: 'allow', scope: 'once' } }),
        })
        expect(await decision.json()).toBe(true)
        await collecting
        await shutdown()
        model.stop()
        expect(chunks.some(chunk => chunk.type === 'data-permission-request')).toBe(true)
        expect(chunks.some(chunk => chunk.type === 'data-permission-resolve')).toBe(true)
    })

    it('accepts, persists and sends a user image through the HTTP agent flow', async () => {
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXsAAAAASUVORK5CYII=', 'base64')
        let receivedImage = false
        const model = Bun.serve({ port: 0, fetch: async request => {
            receivedImage = JSON.stringify((await request.json() as any).messages).includes(png.toString('base64'))
            const call = { index: 0, id: 'finish-image-http', type: 'function', function: { name: 'finish', arguments: '{"result":"seen"}' } }
            return new Response(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', tool_calls: [call] }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
        } })
        Store.config.providers = [{ name: 'mock', baseURL: `http://127.0.0.1:${model.port}/v1`, key: 'test', models: [{ id: 'model', contextWindow: 100000, maxOutput: 1000 }] }]
        Store.config.permission = [{ tool: '*', match: '*', action: 'allow' }]
        await Config.save({ providers: Store.config.providers, permission: Store.config.permission })
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'mock', 'model')
        const server = await start(0)
        const transport = new DefaultChatTransport({
            api: `http://127.0.0.1:${server.port}/agent/send`,
            prepareSendMessagesRequest: ({ id, messages }) => ({ body: { sessionID: id, message: messages.at(-1) } }),
        })
        const user: any = { id: 'http-image', role: 'user', parts: [
            { type: 'text', text: 'inspect this image' },
            { type: 'file', mediaType: 'image/png', filename: 'pixel.png', url: `data:image/png;base64,${png.toString('base64')}` },
        ] }
        const stream = await transport.sendMessages({ trigger: 'submit-message', chatId: session.id, messageId: user.id, messages: [user], abortSignal: undefined })
        for await (const _chunk of stream) { /* consume */ }
        await shutdown()
        model.stop()
        Store.sessions = {}
        Store.runtimes = {}
        await Session.load()
        expect(receivedImage).toBe(true)
        expect(JSON.stringify(Store.sessions[session.id]!.messages[0])).toContain(png.toString('base64'))
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
        const moved = join(process.env.AGENT_HOME!, 'moved-project')
        await mkdir(moved)
        const updatedWorkspace = await request('/workspace', 'PATCH', { id: workspace.id, path: moved })
        expect((await updatedWorkspace.json() as any).path).toBe(moved)

        const createdSession = await request('/session', 'POST', { workspaceID: workspace.id, provider: 'provider', model: 'model' })
        const session = await createdSession.json() as any
        expect((await request(`/session?id=${session.id}`)).status).toBe(200)
        const updated = await request('/session', 'PATCH', { id: session.id, model: 'other-model' })
        const updatedBody = await updated.json() as any
        expect(updatedBody.model).toBe('other-model')
        expect(updatedBody.provider).toBe('provider')
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

    it('invalidates existing tokens when credentials change', async () => {
        Store.config.auth = { username: 'user', password: 'pass' }
        const login = await request('/login', 'POST', { username: 'user', password: 'pass' })
        const cookie = login.headers.get('set-cookie')!
        expect((await request('/config', 'GET', undefined, cookie)).status).toBe(200)
        expect((await request('/config', 'PATCH', { auth: { username: 'new', password: 'secret' } }, cookie)).status).toBe(200)
        expect((await request('/config', 'GET', undefined, cookie)).status).toBe(401)
    })

    it('stops a manual compact operation and restores idle state', async () => {
        const model = Bun.serve({ port: 0, fetch: request => new Promise(resolve => {
            request.signal.addEventListener('abort', () => resolve(new Response('', { status: 499 })), { once: true })
        }) })
        Store.config.providers = [{ name: 'mock', baseURL: `http://127.0.0.1:${model.port}/v1`, key: 'test', models: [{ id: 'model', contextWindow: 1000, maxOutput: 100 }] }]
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'mock', 'model')
        await Session.append(session.id, { id: 'compact-input', role: 'user', parts: [{ type: 'text', text: 'history' }] })
        const compact = request('/session/compact', 'POST', { sessionID: session.id })
        while (!Store.runtimes[session.id]!.operations.has('compact')) await Bun.sleep(1)
        const events = await request(`/session/events?sessionID=${session.id}`)
        const reader = events.body!.getReader()
        expect((await reader.read()).done).toBe(false)
        const stopped = await request('/agent/stop', 'POST', { sessionID: session.id, operationID: 'compact' })
        expect(await stopped.json()).toBe(true)
        expect((await compact).status).toBe(409)
        let ended = false
        while (!ended) ended = (await reader.read()).done
        model.stop()
        expect(Store.runtimes[session.id]!.status).toBe('idle')
        expect(Store.runtimes[session.id]!.operations.has('compact')).toBe(false)
        expect(Store.runtimes[session.id]!.listeners.size).toBe(0)
    })

    it('stops manual compact while its message hook never resolves', async () => {
        const model = Bun.serve({ port: 0, fetch: () => new Response(`data: {"choices":[{"delta":{"role":"assistant","content":"summary"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } }) })
        Store.config.providers = [{ name: 'mock', baseURL: `http://127.0.0.1:${model.port}/v1`, key: 'test', models: [{ id: 'model', contextWindow: 1000, maxOutput: 100 }] }]
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'mock', 'model')
        await Session.append(session.id, { id: 'compact-hook-input', role: 'user', parts: [{ type: 'text', text: 'history' }] })
        const directory = Path.plugins() + '/blocked-compact'
        await mkdir(directory, { recursive: true })
        await Bun.write(directory + '/index.ts', `export default () => ({ name: 'blocked-compact', hooks: { 'message.append': () => new Promise(() => {}) } })`)
        await Plugin.load('blocked-compact')
        const compact = request('/session/compact', 'POST', { sessionID: session.id })
        while (Store.sessions[session.id]!.messages.length < 2) await Bun.sleep(1)
        const stopped = await request('/agent/stop', 'POST', { sessionID: session.id, operationID: 'compact' })
        const response = await Promise.race([compact, Bun.sleep(500).then(() => null)])
        model.stop()
        await Plugin.reset()
        expect(await stopped.json()).toBe(true)
        expect(response?.status).toBe(409)
        expect(Store.runtimes[session.id]!.status).toBe('idle')
    })

    it('enables and disables a global plugin through HTTP', async () => {
        expect((await request('/plugin')).status).toBe(200)
        const enabled = await request('/plugin', 'PATCH', { name: 'title', enabled: true })
        expect(enabled.status).toBe(200)
        expect(await enabled.json()).toContain('title')
        const disabled = await request('/plugin', 'PATCH', { name: 'title', enabled: false })
        expect(disabled.status).toBe(200)
        expect(await disabled.json()).not.toContain('title')
        expect((await request('/config', 'PATCH', { plugins: { title: { enabled: true } } })).status).toBe(422)
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
        expect(Store.runtimes[session.id]!.listeners.size).toBe(0)
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

    it('does not start a queued send while shutting down', async () => {
        let calls = 0
        const model = Bun.serve({ port: 0, fetch: request => new Promise(resolve => {
            calls += 1
            request.signal.addEventListener('abort', () => setTimeout(() => resolve(new Response('', { status: 499 })), 30), { once: true })
        }) })
        Store.config.providers = [{ name: 'mock', baseURL: `http://127.0.0.1:${model.port}/v1`, key: 'test', models: [{ id: 'model', contextWindow: 1000, maxOutput: 100 }] }]
        await Config.save({ providers: Store.config.providers })
        const workspace = await Workspace.add(process.env.AGENT_HOME!)
        const session = await Session.create(workspace.id, 'mock', 'model')
        await start(0)
        await Agent.send(session.id, 'first')
        while (calls < 1) await Bun.sleep(1)
        const queued = Agent.send(session.id, 'second').then(() => null, error => error as Error)
        await shutdown()
        const error = await queued
        model.stop()
        expect(error?.message).toContain('Session is closing')
        expect(calls).toBe(1)
        expect(Store.runtimes[session.id]!.status).toBe('idle')
        expect(Store.runtimes[session.id]!.sends.pending).toBe(0)
    })

    it('rejects new HTTP work and bounds plugin cleanup during shutdown', async () => {
        const directory = Path.plugins() + '/blocked-unload'
        await mkdir(directory, { recursive: true })
        await Bun.write(directory + '/index.ts', `export default () => ({ name: 'blocked-unload', unload: () => new Promise(() => {}) })`)
        await Plugin.load('blocked-unload')
        const server = await start(0)
        const started = Date.now()
        const closing = shutdown()
        await Bun.sleep(10)
        const rejected = await fetch(`http://127.0.0.1:${server.port}/session`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceID: 'new', provider: 'p', model: 'm' }),
        })
        expect(rejected.status).toBe(503)
        await closing
        expect(Date.now() - started).toBeLessThan(1_000)
    })

    it('unloads earlier plugins when startup fails', async () => {
        const cleaned = join(process.env.AGENT_HOME!, 'startup-cleaned.txt')
        for (const [name, source] of Object.entries({
            'a-good': `export default () => ({ name: 'a-good', unload: () => Bun.write(${JSON.stringify(cleaned)}, 'yes') })`,
            'z-bad': `export default () => { throw new Error('startup plugin failed') }`,
        })) {
            const directory = join(Path.plugins(), name)
            await mkdir(directory, { recursive: true })
            await Bun.write(join(directory, 'index.ts'), source)
        }
        await Config.save({ plugins: { 'a-good': { enabled: true }, 'z-bad': { enabled: true } } })
        await expect(start(0)).rejects.toThrow('startup plugin failed')
        expect(Plugin.list()).toHaveLength(0)
        expect(await Bun.file(cleaned).exists()).toBe(true)
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
