/* 从任意消息 part 建立独立会话，不触碰源会话和工作区文件。 */
import { nanoid } from 'nanoid' // 为分叉会话生成独立 ID。
import Store from '../store.js' // 读取源历史并登记目标会话。

const create = async (sessionID, position) => {
    const source = Store.sessions[sessionID] // 源会话始终保持不变。
    if (Store.runtimes[sessionID].status !== 'idle') throw new Error('Session must be idle') // 等消息稳定。

    const index = source.messages.findIndex(message => message.id === position.messageID) // 定位分叉消息。
    if (index < 0) throw new Error('Message part not found') // 不从不存在的位置建会话。
    const sourceMessage = source.messages[index] // 校验 part 需要原消息内容。
    if (position.partIndex < 0 || position.partIndex >= sourceMessage.parts.length) {
        throw new Error('Message part not found')
    }

    const messages = structuredClone(source.messages.slice(0, index + 1)) // 深拷贝分叉点前历史。
    messages[index].parts = messages[index].parts.slice(0, position.partIndex) // 截断到指定 part 之前。
    if (!messages[index].parts.length) messages.pop() // 空消息不进入目标历史。

    const target = {
        id: nanoid(), workspaceID: source.workspaceID,
        provider: source.provider,
        model: source.model,
        messages,
    }

    const workspace = Store.workspaces[source.workspaceID] // 分叉仍属于同一工作区。
    Store.sessions[target.id] = target // 新历史进入独立会话索引。
    Store.runtimes[target.id] = {
        status: 'idle', abortController: new AbortController(), clients: new Set(),
        processes: new Set(), permission: new Map(), events: [],
    }
    workspace.sessions.push({ id: target.id, title: '', lastActiveAt: new Date().toISOString() }) // 加入侧栏。

    await Store.save(target.id) // 先写目标会话详情。
    await Store.save('workspaces') // 再写包含目标 ID 的工作区摘要。
    return target // 返回可继续对话的新会话。
}

export default { create } // 暴露历史分叉入口。
