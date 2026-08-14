/* 工作区及其会话摘要。不会修改用户的工作目录。 */
import { stat } from 'node:fs/promises'
import { nanoid } from 'nanoid'
import Store from '../store.js'

const list = () => Object.values(Store.workspaces)
const add = async path => {
    if (!await stat(path).then(value => value.isDirectory()).catch(() => false)) throw new Error('Workspace directory not found')
    const workspace = { id: nanoid(), path, sessions: [] }
    Store.workspaces[workspace.id] = workspace
    await Store.save('workspaces')
    return workspace
}
const remove = async id => {
    if (Store.workspaces[id]?.sessions.length) return false
    delete Store.workspaces[id]
    await Store.save('workspaces')
    return true
}

export default { list, add, remove }
