/* HTTP 边界只校验和转发，业务逻辑都在 commands/features。 */
import { Elysia, t } from 'elysia'
import { createUIMessageStreamResponse } from 'ai'
import Store from './store.js'
import Auth from './commands/auth.js'
import Config from './commands/config.js'
import Workspace from './commands/workspace.js'
import Session from './commands/session.js'
import Agent from './commands/agent.js'
import Permission from './features/permission.js'
import Compact from './features/compact.js'
import Checkpoint from './features/checkpoint.js'
import Fork from './features/fork.js'
import Plugin from './features/plugin.js'
import Tool from './utils/tool.js'
import LLM from './utils/llm.js'

Plugin.setAPI({ Agent, Session, LLM, Store })
let server
let shuttingDown = false
const position = t.Object({ messageID: t.String(), partIndex: t.Integer({ minimum: 0 }) })
const message = t.Object({ id: t.String(), role: t.String(), parts: t.Array(t.Any()) })
const eventStream = id => createUIMessageStreamResponse({ stream: Session.listen(id) })

export const app = new Elysia()
    .onError(({ code, error, set }) => {
        if (code === 'VALIDATION') { set.status = 422; return { error: error.message } }
        if (error instanceof Error) { set.status = 400; return { error: error.message } }
    })
    .onBeforeHandle(({ path, cookie, status }) => {
        if (shuttingDown && path !== '/health') return status(503, { error: 'Server is shutting down' })
        if (path === '/health' || path === '/login') return
        if (!Auth.verify(cookie.agent?.value)) return status(401, { error: 'Unauthorized' })
    })
    .get('/health', () => ({ ok: true }))
    .post('/login', ({ body, cookie, status }) => {
        const token = Auth.login(body.username, body.password)
        if (!token) return status(401, { error: 'Invalid credentials' })
        cookie.agent.set({ value: token, httpOnly: true, sameSite: 'strict', path: '/' })
        return { ok: true }
    }, { body: t.Object({ username: t.String(), password: t.String() }) })
    .post('/logout', ({ cookie }) => { Auth.logout(cookie.agent.value); cookie.agent.remove(); return { ok: true } })
    .get('/config', () => Config.read())
    .patch('/config', ({ body }) => Config.save(body), { body: t.Record(t.String(), t.Any()) })
    .get('/workspace', () => Workspace.list())
    .post('/workspace', ({ body }) => Workspace.add(body.path), { body: t.Object({ path: t.String() }) })
    .delete('/workspace', ({ query }) => Workspace.remove(query.id), { query: t.Object({ id: t.String() }) })
    .get('/session', ({ query }) => Session.read(query.id), { query: t.Object({ id: t.String() }) })
    .post('/session', ({ body }) => Session.create(body.workspaceID, body.provider, body.model), { body: t.Object({ workspaceID: t.String(), provider: t.String(), model: t.String() }) })
    .patch('/session', ({ body }) => Session.update(body.id, body), { body: t.Intersect([t.Object({ id: t.String() }), t.Partial(t.Object({ provider: t.String(), model: t.String(), title: t.String() }))]) })
    .delete('/session', ({ query }) => Session.remove(query.id), { query: t.Object({ id: t.String() }) })
    .post('/agent/send', async ({ body }) => { await Agent.send(body.sessionID, body.message); return eventStream(body.sessionID) }, { body: t.Object({ sessionID: t.String(), message: t.Union([t.String(), message]) }) })
    .post('/agent/stop', ({ body }) => Agent.stop(body.sessionID), { body: t.Object({ sessionID: t.String() }) })
    .get('/session/events', ({ query }) => eventStream(query.sessionID), { query: t.Object({ sessionID: t.String() }) })
    .post('/permission/decide', ({ body }) => Permission.decide(body.sessionID, body.callID, body.action, body.scope), { body: t.Object({ sessionID: t.String(), callID: t.String(), action: t.Union([t.Literal('allow'), t.Literal('deny')]), scope: t.Union([t.Literal('once'), t.Literal('always')]) }) })
    .post('/session/compact', ({ body }) => Compact.run(body.sessionID), { body: t.Object({ sessionID: t.String() }) })
    .post('/checkpoint/rollback', ({ body }) => Checkpoint.rollback(body.sessionID, body), { body: t.Intersect([position, t.Object({ sessionID: t.String() })]) })
    .post('/checkpoint/undo', ({ body }) => Checkpoint.undo(body.sessionID), { body: t.Object({ sessionID: t.String() }) })
    .post('/session/fork', ({ body }) => Fork.create(body.sessionID, body), { body: t.Intersect([position, t.Object({ sessionID: t.String() })]) })
    .get('/plugin', () => Plugin.list())
    .post('/plugin', ({ body }) => Plugin.load(body.name), { body: t.Object({ name: t.Optional(t.String()) }) })
    .delete('/plugin', ({ query }) => Plugin.unload(query.name), { query: t.Object({ name: t.String() }) })
    .get('/tool', ({ query }) => Tool.list(query.workspacePath), { query: t.Object({ workspacePath: t.String() }) })

export const start = async (port = Number(process.env.PORT || 3000), hostname = process.env.HOST || '127.0.0.1') => {
    if (server) throw new Error('HTTP server is already running')
    await Store.load()
    await Plugin.load()
    server = app.listen({ port, hostname }).server
    return server
}
export const shutdown = async () => {
    shuttingDown = true
    await Promise.allSettled(Object.keys(Store.runtimes).map(Agent.stop))
    await Promise.allSettled(Plugin.list().map(Plugin.unload))
    await server?.stop(true)
    server = null
    shuttingDown = false
}

if (import.meta.main) {
    process.once('SIGINT', () => void shutdown())
    process.once('SIGTERM', () => void shutdown())
    await start()
    console.log(`Agent listening on http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 3000}`)
}
