import { Elysia, t } from 'elysia'
import { createUIMessageStreamResponse, type UIMessageChunk } from 'ai'
import Agent from '../commands/agent.ts'
import Permission from '../features/permission.ts'
import Store from '../store.ts'
import Error from '../utils/error.ts'
import { message } from './schema.ts'

const stream = (sessionID: string, subscribe = true) => {
    const runtime = Store.runtimes[sessionID]
    const session = Store.sessions[sessionID]
    if (!session || !runtime) throw Error.notFound('Session not found')
    let listener: (event: UIMessageChunk) => void
    let closed = false
    const detach = () => { closed = true; runtime.listeners.delete(listener) }
    const close = (controller: ReadableStreamDefaultController<UIMessageChunk>) => { if (!closed) { detach(); controller.close() } }
    const response = createUIMessageStreamResponse({ stream: new ReadableStream<UIMessageChunk>({
        start(controller) {
            listener = event => {
                if (closed) return
                try {
                    controller.enqueue(event)
                    if (event.type === 'data-session-status' && (event.data as { status: string }).status === 'idle') close(controller)
                } catch { detach() }
            }
            if (subscribe) runtime.listeners.add(listener)
            controller.enqueue({ type: 'data-session-snapshot', data: { session, status: runtime.status }, transient: true })
            if (subscribe) for (const event of runtime.events) controller.enqueue(event)
            if (subscribe && runtime.status === 'idle') close(controller)
        },
        cancel() { detach() },
    }) })
    return { response, runtime, send: (event: UIMessageChunk) => listener(event) }
}

export default new Elysia()
    .get('/session/events', ({ query }) => {
        const runtime = Store.runtimes[query.sessionID]
        if (!runtime) throw Error.notFound('Session not found')
        return stream(query.sessionID).response
    }, { query: t.Object({ sessionID: t.String() }) })
    .post('/agent/send', async ({ body }) => {
        const output = stream(body.sessionID, false)
        await Agent.send(body.sessionID, body.message as any, output.send)
        return output.response
    }, { body: t.Object({ sessionID: t.String(), message: t.Union([t.String(), message]) }) })
    .post('/agent/stop', ({ body }) => Agent.stop(body.sessionID, body.operationID), { body: t.Object({ sessionID: t.String(), operationID: t.Optional(t.String()) }) })
    .post('/permission/decide', async ({ body }) => Permission.decide(Store.runtimes[body.sessionID]?.permission.get(body.callID), body.callID, body.decision, async event => {
        const runtime = Store.runtimes[body.sessionID]
        if (!runtime) return
        runtime.events.push(event)
        await Promise.allSettled([...runtime.listeners, ...(runtime.sink ? [runtime.sink] : [])].map(listener => listener(event)))
    }), {
        body: t.Object({ sessionID: t.String(), callID: t.String(), decision: t.Object({ action: t.Union([t.Literal('allow'), t.Literal('deny')]), scope: t.Union([t.Literal('once'), t.Literal('always')]) }) }),
    })
