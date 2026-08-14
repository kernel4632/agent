/* Agent 唯一入口：发送消息和停止当前循环。 */
import { nanoid } from 'nanoid'
import Store from '../store.js'
import Session from './session.js'
import Loop from '../features/loop.js'
import Plugin from '../features/plugin.js'

const stop = async (sessionID, waitForSend = true) => {
    if (waitForSend) await gates.get(sessionID)?.catch(() => {})
    const runtime = Store.runtimes[sessionID]
    if (!runtime || runtime.status === 'idle') return false
    runtime.abortController.abort()
    runtime.processes.forEach(process => process.kill())
    runtime.processes.clear()
    await runtime.task?.catch(() => {})
    await runtime.compactTask?.catch(() => {})
    return true
}

const gates = new Map()
const send = async (sessionID, input) => {
    if (Store.closed) throw new Error('Server is shutting down')
    const message = typeof input === 'string'
        ? { id: nanoid(), role: 'user', parts: [{ type: 'text', text: input }] }
        : input
    const previous = gates.get(sessionID) || Promise.resolve()
    const accepted = previous.then(async () => {
        if (Store.closed) throw new Error('Server is shutting down')
        const runtime = Store.runtimes[sessionID]
        if (!runtime || runtime.removing) throw new Error('Session is being removed')
        if (runtime.status === 'running') await stop(sessionID, false)
        await Session.append(sessionID, message)
        if (runtime.removing) throw new Error('Session is being removed')
        runtime.status = 'running'
        runtime.abortController = new AbortController()
        runtime.events = []
        const task = (async () => {
            try {
                await Plugin.emit('message.append', { sessionID, message, signal: runtime.abortController.signal })
                await Loop.run(sessionID)
            } catch (error) {
                runtime.status = 'idle'
                runtime.events = []
                await Store.broadcast(sessionID, { type: 'error', errorText: String(error) })
                await Store.broadcast(sessionID, { type: 'data-status', data: { status: 'idle', reason: 'error' } })
            }
        })()
        runtime.task = task
        void task.finally(() => { if (runtime.task === task) delete runtime.task }).catch(() => {})
    })
    const cleanup = accepted.finally(() => { if (gates.get(sessionID) === cleanup) gates.delete(sessionID) })
    cleanup.catch(() => {})
    gates.set(sessionID, cleanup)
    await accepted
    return message
}

export default { send, stop }
