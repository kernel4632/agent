/* Agent 只有两个动作：发送用户消息，或停止当前循环。 */
import { nanoid } from 'nanoid'
import Store from '../store.js'
import Loop from '../features/loop.js'
import Plugin from '../features/plugin.js'
import Session from './session.js'

const stop = sessionID => {
    const runtime = Store.runtimes[sessionID]
    if (!runtime || runtime.status === 'idle') return false

    runtime.abortController.abort()
    runtime.processes.forEach(process => process.kill())
    runtime.processes.clear()
    return true
}

const send = async (sessionID, input) => {
    const message = typeof input === 'string'
        ? { id: nanoid(), role: 'user', parts: [{ type: 'text', text: input }] }
        : input

    stop(sessionID)
    await Session.append(sessionID, message)

    const runtime = Store.runtimes[sessionID]
    runtime.status = 'running'
    runtime.abortController = new AbortController()
    runtime.events = []

    void Plugin.emit('message.append', {
        sessionID,
        message,
        signal: runtime.abortController.signal,
    }).then(() => Loop.run(sessionID)).catch(async error => {
        runtime.status = 'idle'
        await Store.broadcast(sessionID, { type: 'error', errorText: String(error) })
        await Store.broadcast(sessionID, {
            type: 'data-status',
            data: { status: 'idle', reason: 'error' },
        })
    })

    return message
}

export default { send, stop }
