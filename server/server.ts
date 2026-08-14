import { Elysia, t } from 'elysia'
import { ValiError } from 'valibot'
import Agent from './commands/agent.ts'
import Auth from './commands/auth.ts'
import Config from './commands/config.ts'
import Session from './commands/session.ts'
import Workspace from './commands/workspace.ts'
import LLM from './utils/llm.ts'
import Checkpoint from './features/checkpoint.ts'
import Plugin from './features/plugin.ts'
import Store from './store.ts'
import Error, { HTTPError } from './utils/error.ts'
import ConfigRoutes from './server/config.ts'
import SessionRoutes from './server/session.ts'
import AgentRoutes from './server/agent.ts'

const kernelAPI = { Agent, Session, LLM, Store }
Plugin.setAPI(kernelAPI)
let shuttingDown = false

export const app = new Elysia()
    .onError(({ error, set }) => {
        if (error instanceof ValiError) { set.status = 422; return { error: error.message, code: 'INVALID_INPUT' } }
        if (error instanceof HTTPError) { set.status = error.status; return { error: error.message, code: error.code } }
    })
    .onBeforeHandle(({ path, cookie, status }) => {
        if (shuttingDown && path !== '/health') return status(503, { error: 'Server is shutting down' })
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
    .post('/logout', ({ cookie }) => { Auth.logout((cookie.agent?.value as string | undefined) ?? ''); cookie.agent!.remove(); return { ok: true } })
    .use(ConfigRoutes)
    .use(SessionRoutes)
    .use(AgentRoutes)

let runningServer: ReturnType<typeof app.listen>['server'] | null = null

export const start = async (port = Number(process.env.PORT || 3000), hostname = process.env.HOST || '127.0.0.1') => {
    if (runningServer) throw new globalThis.Error('HTTP server is already running')
    shuttingDown = false
    try {
        await Config.load()
        await Workspace.load()
        await Session.load()
        for (const sessionID of Object.keys(Store.sessions)) await Checkpoint.recover(sessionID)
        for (const [name, config] of Object.entries(Store.config.plugins)) if (config.enabled) await Plugin.load(name)
        const listening = app.listen({ port, hostname })
        if (!listening.server) throw new globalThis.Error('HTTP server failed to start')
        runningServer = listening.server
        return runningServer
    } catch (error) {
        await Plugin.reset(1_000)
        throw error
    }
}

export const shutdown = async () => {
    const server = runningServer
    shuttingDown = true
    for (const runtime of Object.values(Store.runtimes)) {
        runtime.closed = true
        runtime.abort.abort(new DOMException('Server is shutting down', 'AbortError'))
    }
    await Promise.allSettled(Object.keys(Store.runtimes).map(sessionID => Agent.stop(sessionID)))
    await Promise.all(Object.values(Store.runtimes).map(runtime => runtime.sends.onIdle()))
    await Promise.allSettled(Object.keys(Store.runtimes).map(sessionID => Agent.stop(sessionID)))
    await Promise.all(Object.values(Store.runtimes).map(runtime => runtime.writes.onIdle()))
    await Plugin.reset(250)
    await server?.stop(true)
    runningServer = null
    shuttingDown = false
}

if (import.meta.main) {
    process.once('SIGTERM', async () => { await shutdown(); process.exit(0) })
    process.once('SIGINT', async () => { await shutdown(); process.exit(0) })
    await start()
    console.log(`Agent listening on http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 3000}`)
}
