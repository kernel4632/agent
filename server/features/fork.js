/* 从任意消息 part 建立独立会话，不触碰源会话和工作区文件。 */
import { rm } from 'node:fs/promises'
import { nanoid } from 'nanoid'
import Store from '../store.js'
import Path from '../utils/path.js'

const create = async (sessionID, position) => {
    const source = Store.sessions[sessionID]
    if (!source || Store.runtimes[sessionID].status !== 'idle') throw new Error('Session must be idle')
    const index = source.messages.findIndex(message => message.id === position.messageID)
    if (index < 0 || position.partIndex < 0 || position.partIndex >= source.messages[index].parts.length) throw new Error('Message part not found')
    const target = {
        id: nanoid(), workspaceID: source.workspaceID,
        provider: source.provider, model: source.model, messages: structuredClone(source.messages.slice(0, index + 1)),
    }
    target.messages[index].parts = target.messages[index].parts.slice(0, position.partIndex)
    if (!target.messages[index].parts.length) target.messages.pop()

    const workspace = Store.workspaces[source.workspaceID]
    Store.sessions[target.id] = target
    Store.runtimes[target.id] = { status: 'idle', abortController: new AbortController(), clients: new Set(), processes: new Set(), permission: new Map(), events: [] }
    workspace.sessions.push({ id: target.id, title: '', lastActiveAt: new Date().toISOString() })

    try {
        await Store.save(target.id)
        await Store.save('workspaces')
        return target
    } catch (error) {
        workspace.sessions = workspace.sessions.filter(item => item.id !== target.id)
        delete Store.sessions[target.id]
        delete Store.runtimes[target.id]
        await rm(Path.session(target.id), { recursive: true, force: true })
        try { await Store.save('workspaces') } catch (repairError) { throw new AggregateError([error, repairError], 'Fork cleanup failed') }
        throw error
    }
}

export default { create }
