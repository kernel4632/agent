/* 工作区只保存路径和会话摘要，不修改用户的工作目录。 */
import { stat } from 'node:fs/promises' // 确认用户给出的路径真实可用。
import { nanoid } from 'nanoid' // 为工作区生成稳定 ID。
import Store from '../store.js' // 保存工作区目录与会话摘要。

const list = () => {
    return Object.values(Store.workspaces) // 以数组形式提供全部工作区。
}

const add = async path => {
    const info = await stat(path).catch(() => null) // 不存在的路径按无效工作区处理。
    if (!info?.isDirectory()) throw new Error('Workspace directory not found') // 只接受真实目录。

    const workspace = { id: nanoid(), path, sessions: [] } // 新工作区从空会话列表开始。
    Store.workspaces[workspace.id] = workspace // 先进入内存索引，供创建会话使用。
    await Store.save('workspaces') // 持久化目录登记。
    return workspace // 返回包含新 ID 的工作区。
}

const remove = async id => {
    const workspace = Store.workspaces[id] // 找到待删除的工作区登记。
    if (!workspace || workspace.sessions.length) return false // 有会话时不丢弃其历史。

    delete Store.workspaces[id] // 从内存索引移除空工作区。
    await Store.save('workspaces') // 同步更新工作区清单。
    return true // 告知调用方删除已完成。
}

export default { list, add, remove } // 暴露工作区的最小增删查接口。
