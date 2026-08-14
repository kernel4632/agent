/* Agent 的公开入口只有 send 和 stop；具体一轮运行由 agent-loop 线性完成。 */
import { nanoid } from 'nanoid'
import type { UIMessageChunk } from 'ai'
import Store from '../store.ts'
import Session from './session.ts'
import Error from '../utils/error.ts'
import run from './agent-loop.ts'
import type { AgentMessage } from '../types.ts'

const stop = async (sessionID: string, operationID?: string) => {
    const runtime = Store.runtimes[sessionID]
    if (!runtime) return false
    if (operationID) {
        const operation = runtime.operations.get(operationID)
        if (!operation) return false
        operation.abort(new DOMException('User stopped tool execution.', 'AbortError'))
        await runtime.operationTasks.get(operationID)
        return true
    }
    if (runtime.status === 'idle') return false
    runtime.abort.abort(new DOMException('User cancelled.', 'AbortError'))
    await runtime.task
    return true
}

const send = (sessionID: string, input: string | AgentMessage, onEvent?: (event: UIMessageChunk) => void | Promise<void>) => {
    const runtime = Store.runtimes[sessionID]
    if (!runtime) throw Error.notFound('Session not found')
    if (runtime.closed) throw Error.conflict('Session is closing')
    return runtime.sends.add(async () => {
        const session = Store.sessions[sessionID]
        if (!session) throw Error.notFound('Session not found')
        if (typeof input !== 'string' && (!input.id || !['user', 'assistant', 'system'].includes(input.role) || !Array.isArray(input.parts))) throw Error.invalid('Invalid message')
        if (typeof input !== 'string' && session.messages.some(message => message.id === input.id)) throw Error.conflict(`Message already exists: ${input.id}`)
        if (runtime.status === 'running') await stop(sessionID)
        if (runtime.closed) throw Error.conflict('Session is closing')
        const provider = Store.config.providers.find(item => item.name === session.provider)
        const model = provider?.models.find(item => item.id === session.model)
        const workspace = Store.workspaces[session.workspaceID]
        if (!provider || !model) throw new globalThis.Error(`Model not found: ${session.provider}/${session.model}`)
        if (!workspace) throw Error.notFound('Workspace not found')
        const message: AgentMessage = typeof input === 'string' ? { id: nanoid(), role: 'user', createdAt: new Date().toISOString(), parts: [{ type: 'text', text: input }] } : input
        runtime.status = 'running'
        runtime.abort = new AbortController()
        runtime.events = []
        const sink = onEvent
        runtime.sink = sink
        const receive = async (event: UIMessageChunk) => {
            runtime.events.push(event)
            await Promise.allSettled([...runtime.listeners, ...(runtime.sink ? [runtime.sink] : [])].map(listener => listener(event)))
        }
        runtime.task = run({ sessionID, session, message, runtime, provider, model, workspace, onEvent: receive }).finally(() => {
            if (runtime.sink === sink) runtime.sink = undefined
        })
        return message
    })
}

export default { send, stop }
