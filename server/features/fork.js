/* 从任意消息 part 建立独立会话，不触碰源会话和工作区文件。 */
import Store from '../store.js'
import Session from '../commands/session.js'

const create = async (sessionID, position) => {
    const source = Store.sessions[sessionID]
    if (!source || Store.runtimes[sessionID].status !== 'idle') throw new Error('Session must be idle')
    const index = source.messages.findIndex(message => message.id === position.messageID)
    if (index < 0 || position.partIndex < 0 || position.partIndex > source.messages[index].parts.length) throw new Error('Message part not found')
    const target = await Session.create(source.workspaceID, source.provider, source.model)
    target.messages = structuredClone(source.messages.slice(0, index + 1))
    target.messages[index].parts = target.messages[index].parts.slice(0, position.partIndex)
    if (!target.messages[index].parts.length) target.messages.pop()
    await Session.rewrite(target.id)
    return target
}

export default { create }
