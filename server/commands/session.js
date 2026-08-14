/* 会话数据、消息 JSONL 和 SSE 连接。 */
import { rm } from 'node:fs/promises'
import { nanoid } from 'nanoid'
import Store from '../store.js'
import Path from '../utils/path.js'

const writes = new Map()
/* 消息和会话元数据必须按同一顺序落盘。 */
const serial = (id, action) => {
    const previous = writes.get(id) || Promise.resolve()
    const current = previous.catch(() => {}).then(action)
    const cleanup = current.finally(() => { if (writes.get(id) === cleanup) writes.delete(id) })
    cleanup.catch(() => {})
    writes.set(id, cleanup)
    return current
}
const read = id => Store.sessions[id] || null

/* 创建时先保存会话，再把摘要写入工作区索引。 */
const create = async (workspaceID, provider, model) => {
    const workspace = Store.workspaces[workspaceID]
    const session = { id: nanoid(), workspaceID, provider, model, messages: [] }
    Store.sessions[session.id] = session
    Store.runtimes[session.id] = { status: 'idle', abortController: new AbortController(), clients: new Set(), processes: new Set(), permission: new Map(), events: [] }
    workspace.sessions.push({ id: session.id, title: '', lastActiveAt: new Date().toISOString() })
    await Promise.all([Store.save(session.id), Store.save('workspaces')])
    return session
}
const update = (id, patch) => serial(id, async () => {
    const session = Store.sessions[id]
    if (!session) throw new Error('Session not found')
    if (patch.provider !== undefined) session.provider = patch.provider
    if (patch.model !== undefined) session.model = patch.model
    const summary = Store.workspaces[session.workspaceID].sessions.find(item => item.id === id)
    if (patch.title !== undefined) summary.title = patch.title
    summary.lastActiveAt = new Date().toISOString()
    await Promise.all([Store.save(id), Store.save('workspaces')])
    return session
})
const remove = async id => {
    const runtime = Store.runtimes[id]
    if (!runtime) return false
    runtime.removing = true
    runtime.abortController.abort()
    runtime.processes.forEach(process => process.kill())
    runtime.processes.clear()
    await runtime.task?.catch(() => {})
    await runtime.compactTask?.catch(() => {})
    await runtime.checkpointTask?.catch(() => {})
    return serial(id, async () => {
        const current = Store.sessions[id]
        if (!current) return false
        const workspace = Store.workspaces[current.workspaceID]
        workspace.sessions = workspace.sessions.filter(item => item.id !== id)
        delete Store.sessions[id]
        delete Store.runtimes[id]
        await Store.save('workspaces')
        await rm(Path.session(id), { recursive: true, force: true })
        return true
    })
}
const append = async (id, message) => {
    return serial(id, async () => {
        const session = Store.sessions[id]
        if (!session) throw new Error('Session not found')
        session.messages.push(message)
        await Store.save(id)
    })
}
const rewrite = id => serial(id, () => Store.save(id))
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
