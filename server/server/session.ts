import { Elysia, t } from 'elysia'
import Config from '../commands/config.ts'
import Session from '../commands/session.ts'
import Workspace from '../commands/workspace.ts'
import Checkpoint from '../features/checkpoint.ts'
import Compact from '../features/compact.ts'
import Fork from '../features/fork.ts'
import LLM from '../utils/llm.ts'
import Plugin from '../features/plugin.ts'
import Store from '../store.ts'
import Error from '../utils/error.ts'
import Abort from '../utils/abort.ts'
import { position } from './schema.ts'

const compactNow = async (sessionID: string) => {
    const session = Store.sessions[sessionID]
    const runtime = Store.runtimes[sessionID]
    if (!session || !runtime) throw Error.notFound('Session not found')
    if (runtime.status === 'running') throw Error.conflict('Cannot compact a running session')
    const provider = Store.config.providers.find(item => item.name === session.provider)
    const model = provider?.models.find(item => item.id === session.model)
    if (!provider || !model) throw Error.invalid(`Model not found: ${session.provider}/${session.model}`)
    const controller = new AbortController()
    const event = async (value: any) => {
        runtime.events.push(value)
        await Promise.allSettled([...runtime.listeners].map(listener => listener(value)))
    }
    runtime.status = 'running'
    runtime.abort = controller
    runtime.events = []
    const completion = Promise.withResolvers<void>()
    runtime.operations.set('compact', controller)
    runtime.operationTasks.set('compact', completion.promise)
    const task = (async () => {
        await event({ type: 'data-session-status', data: { status: 'running' }, transient: true })
        const summary = await Compact.run(session.messages, {
            signal: controller.signal,
            receive: event,
            chat: (messages, options) => LLM.chat({ provider, model, retry: Store.config.retry, messages, instructions: Store.config.prompts.summary }, options),
        })
        await Session.append(sessionID, summary)
        await Abort.race(Plugin.emit('message.append', { sessionID, message: summary, signal: controller.signal }), controller.signal)
        return summary
    })()
    runtime.task = task.then(() => undefined, () => undefined)
    try { return await task } catch (error) {
        if (controller.signal.aborted) throw Error.conflict('Compact cancelled')
        throw error
    } finally {
        runtime.operations.delete('compact')
        runtime.operationTasks.delete('compact')
        runtime.status = 'idle'
        await event({ type: 'data-session-status', data: { status: 'idle', reason: controller.signal.aborted ? 'abort' : 'compact' }, transient: true })
        runtime.events = []
        completion.resolve()
    }
}

const compact = (sessionID: string) => {
    const runtime = Store.runtimes[sessionID]
    if (!runtime) throw Error.notFound('Session not found')
    return runtime.sends.add(() => compactNow(sessionID))
}

export default new Elysia()
    .get('/workspace', () => Workspace.list())
    .post('/workspace', ({ body }) => Workspace.add(body.path), { body: t.Object({ path: t.String() }) })
    .patch('/workspace', ({ body }) => Workspace.update(body.id, body.path), { body: t.Object({ id: t.String(), path: t.String() }) })
    .delete('/workspace', ({ query }) => Workspace.remove(query.id), { query: t.Object({ id: t.String() }) })
    .get('/session', ({ query }) => Session.read(query.id), { query: t.Object({ id: t.String() }) })
    .post('/session', ({ body }) => Session.create(body.workspaceID, body.provider, body.model), { body: t.Object({ workspaceID: t.String(), provider: t.String(), model: t.String() }) })
    .patch('/session', ({ body }) => Session.update(body.id, { provider: body.provider, model: body.model }), { body: t.Object({ id: t.String(), provider: t.Optional(t.String()), model: t.Optional(t.String()) }) })
    .delete('/session', ({ query }) => Session.remove(query.id), { query: t.Object({ id: t.String() }) })
    .post('/session/fork', ({ body }) => Fork.create(body.sessionID, body), { body: t.Intersect([position, t.Object({ sessionID: t.String() })]) })
    .post('/session/compact', ({ body }) => compact(body.sessionID), { body: t.Object({ sessionID: t.String() }) })
    .post('/checkpoint/rollback', ({ body }) => Checkpoint.rollback(body.sessionID, body), { body: t.Intersect([position, t.Object({ sessionID: t.String() })]) })
    .post('/checkpoint/undo', ({ body }) => Checkpoint.undo(body.sessionID), { body: t.Object({ sessionID: t.String() }) })
