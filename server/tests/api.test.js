import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, test } from 'bun:test'
import { nanoid } from 'nanoid'
import Store from '../store.js'
import Config from '../commands/config.js'
import Workspace from '../commands/workspace.js'
import Session from '../commands/session.js'
import { app, start, shutdown } from '../server.js'

beforeEach(async () => {
    await shutdown()
    process.env.AGENT_HOME = join(tmpdir(), `agent-api-${nanoid()}`)
    await mkdir(process.env.AGENT_HOME, { recursive: true })
    Store.config = structuredClone(Store.defaults); Store.workspaces = {}; Store.sessions = {}; Store.runtimes = {}
    await Store.load()
})
const request = (path, method = 'GET', body, cookie) => app.handle(new Request(`http://agent${path}`, {
    method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
}))

test('validates routes and protects private endpoints', async () => {
    await Config.save({ auth: { username: 'user', password: 'pass' } })
    expect((await request('/health')).status).toBe(200)
    expect((await request('/config')).status).toBe(401)
    expect((await request('/workspace', 'POST', {})).status).toBe(422)
    const login = await request('/login', 'POST', { username: 'user', password: 'pass' })
    expect(login.status).toBe(200)
    expect((await request('/config', 'GET', undefined, login.headers.get('set-cookie'))).status).toBe(200)
    expect((await request('/agent/send', 'POST', { sessionID: 'x', message: { id: 'x', role: 'user', parts: ['bad'] } }, login.headers.get('set-cookie'))).status).toBe(422)
})

test('serves health over a real socket and emits a session snapshot', async () => {
    const workspace = await Workspace.add(process.env.AGENT_HOME)
    const session = await Session.create(workspace.id, 'missing', 'missing')
    const server = await start(0)
    expect(await (await fetch(`http://127.0.0.1:${server.port}/health`)).json()).toEqual({ ok: true })
    const response = await fetch(`http://127.0.0.1:${server.port}/session/events?sessionID=${session.id}`)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(await response.text()).toContain('data-session')
    await shutdown()
})
