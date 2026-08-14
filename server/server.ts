/*
HTTP 入口：Elysia 只负责接收、验证并转发请求，全部业务由公开主体方法完成。
导入 app 可嵌入或测试；直接运行本文件才会读取数据、加载插件并监听端口。
*/
import { Elysia, t } from 'elysia'
import { createUIMessageStreamResponse, type UIMessageChunk } from 'ai'
import Agent from './commands/agent.ts'
import Auth from './commands/auth.ts'
import Config from './commands/config.ts'
import Session from './commands/session.ts'
import Workspace from './commands/workspace.ts'
import Checkpoint from './features/checkpoint.ts'
import Compact from './features/compact.ts'
import Fork from './features/fork.ts'
import Permission from './features/permission.ts'
import Plugin from './features/plugin.ts'
import LLM from './utils/llm.ts'
import Retry from './utils/retry.ts'
import Store from './store.ts'
import Tool from './utils/tool.ts'
import Error, { HTTPError } from './utils/error.ts'
import { ValiError } from 'valibot'

const kernelAPI = { Agent, Session, LLM, Store, Retry }
Plugin.setAPI(kernelAPI)

const position = t.Object({ messageID: t.String(), partIndex: t.Integer({ minimum: 0 }) })
const message = t.Object({
    id: t.String(),
    role: t.Union([t.Literal('user'), t.Literal('assistant'), t.Literal('system')]),
    parts: t.Array(t.Record(t.String(), t.Unknown())),
}, { additionalProperties: true })

export const app = new Elysia()
    .onError(({ error, set }) => {
        if (error instanceof ValiError) {
            set.status = 422
            return { error: error.message, code: 'INVALID_INPUT' }
        }
        if (!(error instanceof HTTPError)) return
        set.status = error.status
        return { error: error.message, code: error.code }
    })
    .onBeforeHandle(({ path, cookie, status }) => {
        if (path === '/health' || path === '/login') return
        if (!Auth.verify(cookie.agent?.value as string | undefined)) return status(401, { error: 'Unauthorized' })
    })
    .get('/health', { ok: true })
    .post('/login', ({ body, cookie, status }) => {
        const token = Auth.login(body.username, body.password)
        if (!token) return status(401, { error: 'Invalid credentials' })
        cookie.agent!.set({ value: token, httpOnly: true, sameSite: 'strict', path: '/' })
        return { ok: true }
    }, { body: t.Object({ username: t.String(), password: t.String() }) })
    .post('/logout', ({ cookie }) => {
        Auth.logout((cookie.agent?.value as string | undefined) ?? '')
        cookie.agent!.remove()
        return { ok: true }
    })
    .get('/config', () => Config.read())
    .patch('/config', ({ body }) => Config.save(body as any), { body: t.Record(t.String(), t.Unknown()) })
    .get('/tool', ({ query }) => Tool.list(query.sessionID), { query: t.Object({ sessionID: t.String() }) })
    .get('/plugin', () => Plugin.list())
    .patch('/plugin', async ({ body }) => {
        await Plugin.setEnabled(body.name, body.enabled)
        return Plugin.list()
    }, { body: t.Object({ name: t.String(), enabled: t.Boolean() }) })
    .get('/workspace', () => Workspace.list())
    .post('/workspace', ({ body }) => Workspace.add(body.path), { body: t.Object({ path: t.String() }) })
    .delete('/workspace', ({ query }) => Workspace.remove(query.id), { query: t.Object({ id: t.String() }) })
    .get('/session', ({ query }) => Session.read(query.id), { query: t.Object({ id: t.String() }) })
    .post('/session', ({ body }) => Session.create(body.workspaceID, body.provider, body.model), {
        body: t.Object({ workspaceID: t.String(), provider: t.String(), model: t.String() }),
    })
    .patch('/session', ({ body }) => Session.update(body.id, { provider: body.provider, model: body.model }), {
        body: t.Object({ id: t.String(), provider: t.Optional(t.String()), model: t.Optional(t.String()) }),
    })
    .delete('/session', ({ query }) => Session.remove(query.id), { query: t.Object({ id: t.String() }) })
    .post('/session/fork', ({ body }) => Fork.create(body.sessionID, body), {
        body: t.Intersect([position, t.Object({ sessionID: t.String() })]),
    })
    .post('/session/compact', ({ body }) => Compact.run(body.sessionID), { body: t.Object({ sessionID: t.String() }) })
    .get('/session/events', ({ query, status }) => {
        const session = Store.sessions[query.sessionID]
        const runtime = Store.runtimes[query.sessionID]
        if (!session || !runtime) throw Error.notFound('Session not found')
        if (runtime.status === 'idle' || !runtime.task) return status(204)
        let listener: (event: UIMessageChunk) => void
        return createUIMessageStreamResponse({ stream: new ReadableStream<UIMessageChunk>({
            start(controller) {
                listener = event => controller.enqueue(event)
                runtime.listeners.add(listener)
                controller.enqueue({ type: 'data-session-snapshot', data: { session, status: runtime.status }, transient: true })
                void runtime.task?.finally(() => {
                    runtime.listeners.delete(listener)
                    controller.close()
                })
            },
            cancel() { runtime.listeners.delete(listener) },
        }) })
    }, { query: t.Object({ sessionID: t.String() }) })
    .post('/agent/send', async ({ body }) => {
        const session = Store.sessions[body.sessionID]
        const runtime = Store.runtimes[body.sessionID]
        if (!session || !runtime) throw Error.notFound('Session not found')
        let listener: (event: UIMessageChunk) => void
        const response = createUIMessageStreamResponse({ stream: new ReadableStream<UIMessageChunk>({
            start(controller) {
                listener = event => {
                    controller.enqueue(event)
                    if (event.type === 'data-session-status' && (event.data as { status: string }).status === 'idle') {
                        runtime.listeners.delete(listener)
                        controller.close()
                    }
                }
                runtime.listeners.add(listener)
                controller.enqueue({ type: 'data-session-snapshot', data: { session, status: runtime.status }, transient: true })
            },
            cancel() { runtime.listeners.delete(listener) },
        }) })
        await Agent.send(body.sessionID, body.message as any, async event => {
            await Promise.all([...runtime.listeners].map(send => send(event)))
        })
        return response
    }, {
        body: t.Object({ sessionID: t.String(), message: t.Union([t.String(), message]) }),
    })
    .post('/agent/stop', ({ body }) => Agent.stop(body.sessionID), { body: t.Object({ sessionID: t.String() }) })
    .post('/permission/decide', ({ body }) => Permission.decide(body.sessionID, body.callID, body.decision, async event => {
        const listeners = Store.runtimes[body.sessionID]?.listeners ?? []
        await Promise.all([...listeners].map(send => send(event)))
    }), {
        body: t.Object({
            sessionID: t.String(),
            callID: t.String(),
            decision: t.Object({
                action: t.Union([t.Literal('allow'), t.Literal('deny')]),
                scope: t.Union([t.Literal('once'), t.Literal('always')]),
            }),
        }),
    })
    .post('/checkpoint/rollback', ({ body }) => Checkpoint.rollback(body.sessionID, body), {
        body: t.Intersect([position, t.Object({ sessionID: t.String() })]),
    })
    .post('/checkpoint/undo', ({ body }) => Checkpoint.undo(body.sessionID), { body: t.Object({ sessionID: t.String() }) })

let runningServer: ReturnType<typeof app.listen>['server'] | null = null

export const start = async (port = Number(process.env.PORT || 3000), hostname = process.env.HOST || '127.0.0.1') => {
    if (runningServer) throw new globalThis.Error('HTTP server is already running')
    await Config.load()
    await Workspace.load()
    await Session.load()
    for (const sessionID of Object.keys(Store.sessions)) await Checkpoint.recover(sessionID)
    Plugin.setAPI(kernelAPI)
    for (const [name, config] of Object.entries(Store.config.plugins)) {
        if (config.enabled) await Plugin.load(name)
    }
    const listening = app.listen({ port, hostname })
    if (!listening.server) throw new globalThis.Error('HTTP server failed to start')
    runningServer = listening.server
    return runningServer
}

export const shutdown = async () => {
    runningServer?.stop(false)
    await Promise.allSettled(Object.keys(Store.runtimes).map(sessionID => Agent.stop(sessionID)))
    await Plugin.reset()
    runningServer?.stop(true)
    runningServer = null
}

if (import.meta.main) {
    process.once('SIGTERM', async () => {
        await shutdown()
        process.exit(0)
    })
    process.once('SIGINT', async () => {
        await shutdown()
        process.exit(0)
    })
    await start()
    console.log(`Agent listening on http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 3000}`)
}
