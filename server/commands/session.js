/* 会话数据、消息 JSONL 和 SSE 连接。 */
import { chmod, rm } from 'node:fs/promises'
import { writeFile } from 'atomically'
import { nanoid } from 'nanoid'
import Store from '../store.js'
import Path from '../utils/path.js'

const writes = new Map()
const serial = (id, action) => {
    const previous = writes.get(id) || Promise.resolve()
    const current = previous.catch(() => {}).then(action)
    const cleanup = current.finally(() => { if (writes.get(id) === cleanup) writes.delete(id) })
    cleanup.catch(() => {})
    writes.set(id, cleanup)
    return current
}
const read = id => Store.sessions[id] || null
const create = async (workspaceID, provider, model) => {
    const workspace = Store.workspaces[workspaceID]
    const session = { id: nanoid(), workspaceID, provider, model, messages: [] }
    Store.sessions[session.id] = session
    Store.runtimes[session.id] = { status: 'idle', abortController: new AbortController(), clients: new Set(), processes: new Set(), permission: new Map(), events: [] }
    workspace.sessions.push({ id: session.id, title: '', lastActiveAt: new Date().toISOString() })
    await Promise.all([Store.save(session.id), Store.save('workspaces')])
    return session
}
const update = async (id, patch) => {
    const session = Store.sessions[id]
    if (patch.provider !== undefined) session.provider = patch.provider
    if (patch.model !== undefined) session.model = patch.model
    const summary = Store.workspaces[session.workspaceID].sessions.find(item => item.id === id)
    if (patch.title !== undefined) summary.title = patch.title
    summary.lastActiveAt = new Date().toISOString()
    await Promise.all([Store.save(id), Store.save('workspaces')])
    return session
}
const remove = async id => {
    if (!Store.sessions[id]) return false
    if (Store.runtimes[id].status === 'running') await (await import('./agent.js')).default.stop(id)
    const workspace = Store.workspaces[Store.sessions[id].workspaceID]
    workspace.sessions = workspace.sessions.filter(item => item.id !== id)
    delete Store.sessions[id]
    delete Store.runtimes[id]
    await Promise.all([Store.save('workspaces'), rm(Path.session(id), { recursive: true, force: true })])
    return true
}
const append = async (id, message) => {
    return serial(id, async () => {
        Store.sessions[id].messages.push(message)
        await writeFile(Path.messages(id), Store.sessions[id].messages.map(JSON.stringify).join('\n') + '\n', { mode: 0o600 })
        await chmod(Path.messages(id), 0o600)
        await Store.save(id)
    })
}
const rewrite = id => serial(id, async () => {
    await writeFile(Path.messages(id), Store.sessions[id].messages.map(JSON.stringify).join('\n') + (Store.sessions[id].messages.length ? '\n' : ''), { mode: 0o600 })
    await chmod(Path.messages(id), 0o600)
})
const listen = id => {
    let controller
    return new ReadableStream({
    start(client) {
        const runtime = Store.runtimes[id]
        if (!runtime) return client.error(new Error('Session not found'))
        controller = client
        runtime.clients.add(controller)
        client.enqueue({ type: 'data-session', data: { session: Store.sessions[id], status: runtime.status } })
        runtime.events.forEach(event => client.enqueue(event))
        if (runtime.status === 'idle') {
            runtime.clients.delete(controller)
            client.close()
        }
    },
    cancel() { Store.runtimes[id]?.clients.delete(controller) },
})
}

export default { read, create, update, remove, append, rewrite, listen }
