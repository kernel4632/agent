/* Agent 只有两个动作：发送用户消息，或停止当前循环。 */
import { nanoid } from 'nanoid'
import Store from '../store.js'
import Loop from '../features/loop.js'
import Plugin from '../features/plugin.js'
import Session from './session.js'

const stop = sessionID => {
    const runtime = Store.runtimes[sessionID]
    if (!runtime) return false
    const running = runtime.status !== 'idle'

    runtime.abortController.abort()
    runtime.processes.forEach(process => process.kill())
    runtime.processes.clear()
    return running
}

const send = async (sessionID, input) => {
    const message = typeof input === 'string'
        ? { id: nanoid(), role: 'user', parts: [{ type: 'text', text: input }] }
        : input

    stop(sessionID)
    const runtime = Store.runtimes[sessionID]
    runtime.status = 'running'
    runtime.abortController = new AbortController()
    runtime.events = []
    const signal = runtime.abortController.signal
    try {
        await Session.append(sessionID, message)
    } catch (error) {
        if (runtime.abortController.signal === signal) runtime.status = 'idle'
        throw error
    }
    if (signal.aborted || runtime.abortController.signal !== signal) return message

    void Plugin.emit('message.append', {
        sessionID, message, signal,
    }).then(() => signal.aborted ? undefined : Loop.run(sessionID)).catch(async error => {
        if (Store.runtimes[sessionID] !== runtime || runtime.abortController.signal !== signal) return

        runtime.status = 'idle'
        await Store.broadcast(sessionID, { type: 'error', errorText: String(error) })
        await Store.broadcast(sessionID, { type: 'data-status', data: { status: 'idle', reason: 'error' } })
    })

    return message
}

export default { send, stop }
