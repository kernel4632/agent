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
    await running.get(sessionID)?.catch(() => {})
    return true
}

const running = new Map()
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
        if (runtime.status === 'running') await stop(sessionID, false)
        await Session.append(sessionID, message)
        runtime.status = 'running'
        runtime.abortController = new AbortController()
        runtime.events = []
        const task = (async () => {
            try {
                await Plugin.emit('message.append', { sessionID, message, signal: runtime.abortController.signal })
                await Loop.run(sessionID)
            } catch (error) {
                runtime.status = 'idle'
                await Store.broadcast(sessionID, { type: 'error', errorText: String(error) })
                await Store.broadcast(sessionID, { type: 'data-status', data: { status: 'idle', reason: 'error' } })
            }
        })()
        running.set(sessionID, task)
        void task.finally(() => { if (running.get(sessionID) === task) running.delete(sessionID) }).catch(() => {})
    })
    const cleanup = accepted.finally(() => { if (gates.get(sessionID) === cleanup) gates.delete(sessionID) })
    cleanup.catch(() => {})
    gates.set(sessionID, cleanup)
    await accepted
    return message
}

export default { send, stop }
