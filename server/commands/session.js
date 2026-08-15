/* 会话保存消息，运行态保存 SSE、进程和审批等待者。 */
import { rm } from 'node:fs/promises'
import { nanoid } from 'nanoid'
import Store from '../store.js'
import Path from '../utils/path.js'

const read = id => Store.sessions[id] || null

const create = async (workspaceID, provider, model) => {
    const workspace = Store.workspaces[workspaceID]
    if (!workspace) throw new Error('Workspace not found')

    const session = { id: nanoid(), workspaceID, provider, model, messages: [] }
    Store.sessions[session.id] = session
    Store.runtimes[session.id] = {
        status: 'idle',
        abortController: new AbortController(),
        clients: new Set(),
        processes: new Set(),
        permission: new Map(),
        events: [],
    }

    workspace.sessions.push({ id: session.id, title: '', lastActiveAt: new Date().toISOString() })
    await Promise.all([Store.save(session.id), Store.save('workspaces')])
    return session
}

const update = async (id, patch) => {
    const session = Store.sessions[id]
    if (!session) throw new Error('Session not found')

    if (patch.provider !== undefined) session.provider = patch.provider
    if (patch.model !== undefined) session.model = patch.model

    const workspace = Store.workspaces[session.workspaceID]
    const summary = workspace.sessions.find(item => item.id === id)
    if (patch.title !== undefined) summary.title = patch.title
    summary.lastActiveAt = new Date().toISOString()

    await Promise.all([Store.save(id), Store.save('workspaces')])
    return session
}

const remove = async id => {
    const runtime = Store.runtimes[id]
    const session = Store.sessions[id]
    if (!runtime || !session) return false

    runtime.abortController.abort()
    runtime.processes.forEach(process => process.kill())
    runtime.permission.values().forEach(resolve => resolve(false))
    const workspace = Store.workspaces[session.workspaceID]
    workspace.sessions = workspace.sessions.filter(item => item.id !== id)

    delete Store.sessions[id]
    delete Store.runtimes[id]
    await Store.save('workspaces')
    await rm(Path.session(id), { recursive: true, force: true })
    return true
}

const append = async (id, message) => {
    const session = Store.sessions[id]
    if (!session) throw new Error('Session not found')

    session.messages.push(message)
    await Store.save(id)
}

const rewrite = id => Store.save(id)

const listen = id => {
    let controller
    return new ReadableStream({
        start(client) {
            const runtime = Store.runtimes[id]
            if (!runtime) return client.error(new Error('Session not found'))

            controller = client
            runtime.clients.add(client)
            client.enqueue({
                type: 'data-session',
                data: { session: Store.sessions[id], status: runtime.status },
            })
            runtime.events.forEach(event => client.enqueue(event))

            if (runtime.status === 'idle') {
                runtime.clients.delete(client)
                client.close()
            }
        },
        cancel() {
            Store.runtimes[id]?.clients.delete(controller)
        },
    })
}

export default { read, create, update, remove, append, rewrite, listen }
