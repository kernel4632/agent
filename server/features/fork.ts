/*
会话分支：从指定消息 part 复制出一个新会话，原会话与工作区文件都保持不变。
分支使用与检查点相同的位置表达，允许从任意消息块开始另一条思路。
*/
import Session from '../commands/session.ts'
import Store from '../store.ts'
import type { CheckpointPosition } from '../types.ts'
import Error from '../utils/error.ts'

const createNow = async (sessionID: string, position: CheckpointPosition) => {
    const source = Store.sessions[sessionID]
    if (!source) throw Error.notFound('Session not found')
    if (Store.runtimes[sessionID]!.status === 'running') throw Error.conflict('Cannot fork a running session')
    const messages = structuredClone(source.messages)
    const messageIndex = messages.findIndex(message => message.id === position.messageID)
    if (messageIndex < 0) throw Error.notFound('Message not found')
    if (position.partIndex < 0 || position.partIndex > messages[messageIndex]!.parts.length) throw Error.invalid('Part not found')
    const target = await Session.create(source.workspaceID, source.provider, source.model)
    target.messages = messages
    Session.truncate(target.id, position)
    await Session.rewrite(target.id)
    return target
}

const create = (sessionID: string, position: CheckpointPosition) => {
    const runtime = Store.runtimes[sessionID]
    if (!runtime) throw Error.notFound('Session not found')
    return runtime.sends.add(() => createNow(sessionID, position))
}

export default { create }
