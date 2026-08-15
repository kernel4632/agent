/* 从任意消息 part 建立独立会话，不触碰源会话和工作区文件。 */
import { nanoid } from 'nanoid'
import Store from '../store.js'

const create = async (sessionID, position) => {
    const source = Store.sessions[sessionID]
    if (Store.runtimes[sessionID].status !== 'idle') throw new Error('Session must be idle')

    const index = source.messages.findIndex(message => message.id === position.messageID)
    if (index < 0) throw new Error('Message part not found')
    const sourceMessage = source.messages[index]
    if (position.partIndex < 0 || position.partIndex >= sourceMessage.parts.length) {
        throw new Error('Message part not found')
    }

    const messages = structuredClone(source.messages.slice(0, index + 1))
    messages[index].parts = messages[index].parts.slice(0, position.partIndex)
    if (!messages[index].parts.length) messages.pop()

    const target = {
        id: nanoid(), workspaceID: source.workspaceID,
        provider: source.provider,
        model: source.model,
        messages,
    }

    const workspace = Store.workspaces[source.workspaceID]
    Store.sessions[target.id] = target
    Store.runtimes[target.id] = {
        status: 'idle', abortController: new AbortController(), clients: new Set(),
        processes: new Set(), permission: new Map(), events: [],
    }
    workspace.sessions.push({ id: target.id, title: '', lastActiveAt: new Date().toISOString() })

    await Store.save(target.id)
    await Store.save('workspaces')
    return target
}

export default { create }
