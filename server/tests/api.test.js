import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { nanoid } from 'nanoid'
import Store from '../store.js'
import Config from '../commands/config.js'
import Workspace from '../commands/workspace.js'
import Session from '../commands/session.js'
import Plugin from '../features/plugin.js'
import Path from '../utils/path.js'
import { start, shutdown } from '../server.js'

let baseURL
let liveServer

beforeEach(async () => {
    await shutdown()
    process.env.AGENT_HOME = join(tmpdir(), `agent-api-${nanoid()}`)
    await mkdir(process.env.AGENT_HOME, { recursive: true })
    Store.workspaces = {}; Store.sessions = {}; Store.runtimes = {}
    liveServer = await start(0)
    baseURL = `http://127.0.0.1:${liveServer.port}`
})
afterEach(() => shutdown())
const request = (path, method = 'GET', body, cookie) => fetch(`${baseURL}${path}`, {
    method,
    headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
})
const provider = port => [{
    name: 'mock', baseURL: `http://127.0.0.1:${port}/v1`, key: 'test',
    models: [{ id: 'model', contextWindow: 1000, maxOutput: 100 }],
}]

test('validates routes and protects private endpoints', async () => {
    await Config.save({ auth: { username: 'user', password: 'pass' } })
    expect((await request('/health')).status).toBe(200)
    expect((await request('/config')).status).toBe(401)
    expect((await request('/workspace', 'POST', {})).status).toBe(422)
    const login = await request('/login', 'POST', { username: 'user', password: 'pass' })
    expect(login.status).toBe(200)
    expect((await request('/config', 'GET', undefined, login.headers.get('set-cookie'))).status).toBe(200)
    const invalid = { sessionID: 'x', message: { id: 'x', role: 'user', parts: ['bad'] } }
    expect((await request('/agent/send', 'POST', invalid, login.headers.get('set-cookie'))).status).toBe(422)
    expect((await request('/logout', 'POST', undefined, login.headers.get('set-cookie'))).status).toBe(200)
    expect((await request('/config', 'GET', undefined, login.headers.get('set-cookie'))).status).toBe(401)
})

test('agent send returns the accepted message and leaves streaming separate', async () => {
    await Config.save({ auth: { username: 'user', password: 'pass' } })
    const login = await request('/login', 'POST', { username: 'user', password: 'pass' })
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'missing', 'missing')
    const response = await request('/agent/send', 'POST', {
        sessionID: session.id, message: 'hello',
    }, login.headers.get('set-cookie'))
    expect(response.status).toBe(200)
    expect((await response.json()).parts[0].text).toBe('hello')
    await shutdown()
    Store.sessions = {}; Store.workspaces = {}; Store.runtimes = {}
    await Store.load()
    expect(Store.sessions[session.id].messages[0].parts[0].text).toBe('hello')
})

test('agent send preserves UIMessage metadata', async () => {
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'missing', 'missing')
    const message = {
        id: 'metadata', role: 'user', metadata: { source: 'test' },
        parts: [{ type: 'text', text: 'hello' }],
    }
    const response = await request('/agent/send', 'POST', { sessionID: session.id, message })
    expect(response.status).toBe(200)
    expect((await response.json()).metadata).toEqual({ source: 'test' })
    await shutdown()
})

test('serves health over a real socket and emits a session snapshot', async () => {
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'missing', 'missing')
    expect(await (await fetch(`${baseURL}/health`)).json()).toEqual({ ok: true })
    const response = await fetch(`${baseURL}/session/events?sessionID=${session.id}`)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(await response.text()).toContain('data-session')
    await shutdown()
})

test('shutdown reports a final save failure', async () => {
    const server = liveServer
    const save = Store.save
    Store.save = async domain => domain === 'config' ? Promise.reject(new Error('flush failed')) : save(domain)
    await expect(shutdown()).rejects.toThrow('flush failed')
    Store.save = save
    await shutdown()
    await expect(fetch(`http://127.0.0.1:${server.port}/health`)).rejects.toBeDefined()
})

test('shutdown aborts and waits for active model work', async () => {
    let started = false
    let aborted = false
    const model = Bun.serve({ port: 0, fetch: request => new Promise(resolve => {
        started = true
        request.signal.addEventListener('abort', () => {
            aborted = true
            resolve(new Response('', { status: 499 }))
        }, { once: true })
    }) })
    Store.config.providers = provider(model.port)
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'mock', 'model')
    await request('/agent/send', 'POST', { sessionID: session.id, message: 'wait' })
    while (!started) await Bun.sleep(5)
    await shutdown()
    model.stop()
    expect(aborted).toBe(true)
    expect(Store.runtimes[session.id].status).toBe('idle')
})

test('shutdown aborts background title work while the session is idle', async () => {
    let started = false
    let aborted = false
    const model = Bun.serve({ port: 0, fetch: request => new Promise(resolve => {
        started = true
        request.signal.addEventListener('abort', () => {
            aborted = true
            resolve(new Response('', { status: 499 }))
        }, { once: true })
    }) })
    Store.config.providers = provider(model.port)
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'mock', 'model')
    const signal = Store.runtimes[session.id].abortController.signal
    await Plugin.emit('message.append', {
        sessionID: session.id, signal,
        message: { role: 'user', parts: [{ type: 'text', text: 'title me' }] },
    })
    while (!started) await Bun.sleep(5)
    await shutdown()
    model.stop()
    expect(aborted).toBe(true)
})

test('shutdown closes the server after a plugin unload failure', async () => {
    const directory = join(Path.plugins(), 'failing')
    await mkdir(directory, { recursive: true })
    await Bun.write(join(directory, 'index.js'), `
        let failed = false
        export default () => ({
            name: 'failing',
            unload() {
                if (!failed) { failed = true; throw new Error('unload failed') }
            },
        })
    `)
    await Plugin.load('failing')
    const port = liveServer.port
    await expect(shutdown()).rejects.toThrow('unload failed')
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toBeDefined()
    await shutdown()
})

test('covers the remaining command and feature routes', async () => {
    const workspace = await (await request('/workspace', 'POST', { path: process.env.AGENT_HOME })).json()
    expect((await request('/workspace')).status).toBe(200)
    expect((await request('/config', 'PATCH', { prompts: { system: 'test' } })).status).toBe(200)
    const sessionResponse = await request('/session', 'POST', {
        workspaceID: workspace.id, provider: 'missing', model: 'missing',
    })
    const session = await sessionResponse.json()
    expect((await request(`/session?id=${session.id}`)).status).toBe(200)
    expect((await request('/session', 'PATCH', { id: session.id, title: 'API test' })).status).toBe(200)
    expect((await request(`/tool?workspacePath=${encodeURIComponent(process.env.AGENT_HOME)}`)).status).toBe(200)
    expect((await request('/agent/stop', 'POST', { sessionID: session.id })).status).toBe(200)
    const decision = { sessionID: session.id, callID: 'missing', action: 'deny', scope: 'once' }
    expect((await request('/permission/decide', 'POST', decision)).status).toBe(200)
    expect((await request('/session/compact', 'POST', { sessionID: session.id })).status).toBe(400)
    expect((await request('/checkpoint/undo', 'POST', { sessionID: session.id })).status).toBe(200)
    const position = { sessionID: session.id, messageID: 'missing', partIndex: 0 }
    expect((await request('/checkpoint/rollback', 'POST', position)).status).toBe(400)
    expect((await request('/session/fork', 'POST', position)).status).toBe(400)
    expect((await request('/plugin', 'GET')).status).toBe(200)
    expect((await request('/plugin', 'POST', { name: 'title' })).status).toBe(200)
    expect((await request('/plugin', 'DELETE', undefined, undefined)).status).toBe(422)
    expect((await request(`/plugin?name=title`, 'DELETE')).status).toBe(200)
    expect((await request(`/session?id=${session.id}`, 'DELETE')).status).toBe(200)
    expect((await request(`/workspace?id=${workspace.id}`, 'DELETE')).status).toBe(200)
})
