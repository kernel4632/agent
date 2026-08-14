/*
工作区指令：加载并管理 Agent 可以进入的项目目录。
工作区只保存目录引用和会话摘要，移除它不会删除用户项目文件。
*/
import { chmod, readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { writeFile } from 'atomically'
import { nanoid } from 'nanoid'
import Store from '../store.ts'
import Error from '../utils/error.ts'
import Path from '../utils/path.ts'
import type { WorkspaceData } from '../types.ts'

let saving = Promise.resolve()

const load = async () => {
    const file = await readFile(Path.workspaces(), 'utf8').catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
        throw error
    })
    try {
        Store.workspaces = file ? JSON.parse(file) : {}
    } catch {
        throw new globalThis.Error(`Invalid JSON: ${Path.workspaces()}`)
    }
    await save()
    return Store.workspaces
}

const save = async () => {
    const previous = saving
    let release = () => {}
    saving = new Promise<void>(resolve => { release = resolve })
    await previous
    try {
        await writeFile(Path.workspaces(), JSON.stringify(Store.workspaces, null, 2), { mode: 0o600 })
        await chmod(Path.workspaces(), 0o600)
    } finally {
        release()
    }
}

const list = () => Object.values(Store.workspaces)

const add = async (path: string) => {
    const absolutePath = resolve(path)
    if (!(await stat(absolutePath).catch(() => null))?.isDirectory()) throw Error.invalid('Workspace must be a directory')
    const existing = list().find(workspace => workspace.path === absolutePath)
    if (existing) return existing
    const workspace: WorkspaceData = { id: nanoid(), path: absolutePath, sessions: [] }
    Store.workspaces[workspace.id] = workspace
    await save()
    return workspace
}

const update = async (workspaceID: string, path: string) => {
    const workspace = Store.workspaces[workspaceID]
    if (!workspace) throw Error.notFound('Workspace not found')
    const absolutePath = resolve(path)
    if (!(await stat(absolutePath).catch(() => null))?.isDirectory()) throw Error.invalid('Workspace must be a directory')
    if (list().some(item => item.id !== workspaceID && item.path === absolutePath)) throw Error.conflict('Workspace path already exists')
    workspace.path = absolutePath
    await save()
    return workspace
}

const remove = async (workspaceID: string) => {
    const workspace = Store.workspaces[workspaceID]
    if (!workspace) return false
    if (workspace.sessions.length) throw Error.conflict('Cannot remove a workspace with sessions')
    delete Store.workspaces[workspaceID]
    await save()
    return true
}

export default { load, save, list, add, update, remove }
