/* Agent 唯一入口：发送消息和停止当前循环。 */
import { nanoid } from 'nanoid'
import Store from '../store.js'
import Session from './session.js'
import Loop from '../features/loop.js'
import Plugin from '../features/plugin.js'

const stop = async sessionID => {
    const runtime = Store.runtimes[sessionID]
    if (!runtime || runtime.status === 'idle') return false
    runtime.abortController.abort()
    runtime.processes.forEach(process => process.kill())
    runtime.processes.clear()
    runtime.status = 'idle'
    await Store.broadcast(sessionID, { type: 'data-status', data: { status: 'idle' } })
    return true
}

const send = async (sessionID, input) => {
    const runtime = Store.runtimes[sessionID]
    if (runtime.status === 'running') await stop(sessionID)
    const message = typeof input === 'string'
        ? { id: nanoid(), role: 'user', parts: [{ type: 'text', text: input }] }
        : input
    await Session.append(sessionID, message)
    await Plugin.emit('message.append', { sessionID, message })
    runtime.status = 'running'
    runtime.abortController = new AbortController()
    runtime.events = []
    void Loop.run(sessionID)
    return message
}

export default { send, stop }
