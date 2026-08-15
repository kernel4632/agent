/* HTTP 入口只负责 schema、鉴权和转发。 */
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

const id = t.Object({ id: t.String() })
const sessionID = t.Object({ sessionID: t.String() })
const message = t.Object({
    id: t.String(), role: t.Literal('user'),
    parts: t.Array(t.Object({ type: t.String() }, { additionalProperties: true })),
}, { additionalProperties: true })
const sessionFields = t.Partial(t.Object({ provider: t.String(), model: t.String(), title: t.String() }))
const sessionPatch = t.Intersect([id, sessionFields])
const positionRequest = t.Object({ sessionID: t.String(), messageID: t.String(), partIndex: t.Integer({ minimum: 0 }) })
const pluginBody = t.Optional(t.Object({ name: t.Optional(t.String()) }))

const app = new Elysia()
    .onError(({ code, error, status }) => status(code === 'VALIDATION' ? 422 : 400, { error: error.message }))
    .onBeforeHandle(({ path, cookie, status }) => {
        const publicPath = path === '/health' || path === '/login'
        if (!publicPath && !Auth.verify(cookie.agent?.value)) return status(401)
    })

    // 登录与配置。
    .get('/health', () => ({ ok: true }))
    .post('/login', ({ body, cookie, status }) => {
        const token = Auth.login(body.username, body.password)
        if (!token) return status(401, { error: 'Invalid credentials' })
        cookie.agent.set({ value: token, httpOnly: true, sameSite: 'strict', path: '/' })
        return { ok: true }
    }, { body: t.Object({ username: t.String(), password: t.String() }) })
    .post('/logout', ({ cookie }) => {
        Auth.logout(cookie.agent.value)
        cookie.agent.remove()
        return { ok: true }
    })
    .get('/config', () => Config.read())
    .patch('/config', ({ body }) => Config.save(body), { body: t.Partial(t.Record(t.String(), t.Any())) })

    // 工作区与会话元数据。
    .get('/workspace', () => Workspace.list())
    .post('/workspace', ({ body }) => Workspace.add(body.path), { body: t.Object({ path: t.String() }) })
    .delete('/workspace', ({ query }) => Workspace.remove(query.id), { query: id })
    .get('/session', ({ query }) => Session.read(query.id), { query: id })
    .post('/session', ({ body }) => Session.create(body.workspaceID, body.provider, body.model), {
        body: t.Object({ workspaceID: t.String(), provider: t.String(), model: t.String() }),
    })
    .patch('/session', ({ body: { id, ...patch } }) => Session.update(id, patch), { body: sessionPatch })
    .delete('/session', ({ query }) => Session.remove(query.id), { query: id })

    // Agent 工作和实时事件。
    .post('/agent/send', ({ body }) => Agent.send(body.sessionID, body.message), {
        body: t.Object({ sessionID: t.String(), message: t.Union([t.String(), message]) }),
    })
    .post('/agent/stop', ({ body }) => Agent.stop(body.sessionID), { body: sessionID })
    .get('/session/events', ({ query }) => createUIMessageStreamResponse({
        stream: Session.listen(query.sessionID),
    }), { query: sessionID })
    .post('/permission/decide', ({ body }) => Permission.decide(body.sessionID, body.callID, body.action, body.scope), {
        body: t.Object({
            sessionID: t.String(), callID: t.String(),
            action: t.Union([t.Literal('allow'), t.Literal('deny')]),
            scope: t.Union([t.Literal('once'), t.Literal('always')]),
        }),
    })

    // 历史压缩、回滚与分叉。
    .post('/session/compact', ({ body }) => Compact.run(body.sessionID), { body: sessionID })
    .post('/checkpoint/rollback', ({ body }) => Checkpoint.rollback(body.sessionID, body), { body: positionRequest })
    .post('/checkpoint/undo', ({ body }) => Checkpoint.undo(body.sessionID), { body: sessionID })
    .post('/session/fork', ({ body }) => Fork.create(body.sessionID, body), { body: positionRequest })

    // 插件和工具目录查询。
    .get('/plugin', () => Plugin.list())
    .post('/plugin', ({ body }) => Plugin.load(body?.name), { body: pluginBody })
    .delete('/plugin', ({ query }) => Plugin.unload(query.name), { query: t.Object({ name: t.String() }) })
    .get('/tool', ({ query }) => Tool.list(query.workspacePath), { query: t.Object({ workspacePath: t.String() }) })

export const start = async (port = Number(process.env.PORT || 3000)) => {
    await Store.load()
    await Plugin.load()
    server = app.listen({ port, hostname: process.env.HOST || '127.0.0.1' }).server
    return server
}

export const shutdown = async () => {
    Object.keys(Store.runtimes).forEach(Agent.stop)
    while (Object.values(Store.runtimes).some(runtime => runtime.status === 'running')) await Bun.sleep(5)

    const unloaded = await Promise.allSettled(Plugin.list().map(Plugin.unload))
    const domains = ['config', 'workspaces', ...Object.keys(Store.sessions)]
    const saved = await Promise.allSettled(domains.map(domain => Store.save(domain)))
    const failure = [...unloaded, ...saved].find(result => result.status === 'rejected')?.reason
    await server?.stop(true)
    server = null
    if (failure) throw failure
}

if (import.meta.main) {
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void shutdown())
    await start()
    console.log(`Agent listening on http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 3000}`)
}
