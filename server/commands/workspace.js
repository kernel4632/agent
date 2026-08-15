/* 工作区只保存路径和会话摘要，不修改用户的工作目录。 */
import { stat } from 'node:fs/promises'
import { nanoid } from 'nanoid'
import Store from '../store.js'

const list = () => {
    return Object.values(Store.workspaces)
}

const add = async path => {
    const info = await stat(path).catch(() => null)
    if (!info?.isDirectory()) throw new Error('Workspace directory not found')

    const workspace = { id: nanoid(), path, sessions: [] }
    Store.workspaces[workspace.id] = workspace
    await Store.save('workspaces')
    return workspace
}

const remove = async id => {
    const workspace = Store.workspaces[id]
    if (!workspace || workspace.sessions.length) return false

    delete Store.workspaces[id]
    await Store.save('workspaces')
    return true
}

export default { list, add, remove }
