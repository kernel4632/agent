/*
工具注册与执行：按内置、全局、工作区、插件的顺序组装当前会话可用工具。
所有来源使用相同 AgentTool 契约，放进目录即可生效，不维护注册清单。
*/
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stat } from 'node:fs/promises'
import Path from './path.ts'
import Plugin from '../features/plugin.ts'
import Store from '../store.ts'
import type { AgentTool } from '../types.ts'
import Error from './error.ts'

const list = async (sessionID: string) => {
    const session = Store.sessions[sessionID]
    if (!session) throw Error.notFound('Session not found')
    const workspace = Store.workspaces[session.workspaceID]
    if (!workspace) throw Error.notFound('Workspace not found')
    const tools: Record<string, AgentTool> = {}
    for (const directory of [resolve(dirname(fileURLToPath(import.meta.url)), '../tools'), Path.tools(), Path.workspaceTools(workspace.path)]) {
        if (!await stat(directory).then(value => value.isDirectory()).catch(() => false)) continue
        const glob = new Bun.Glob('*.{js,ts}')
        for await (const file of glob.scan({ cwd: directory, absolute: true, onlyFiles: true })) {
            const exported = (await import(file)).default as AgentTool | AgentTool[]
            for (const tool of Array.isArray(exported) ? exported : [exported]) tools[tool.name] = tool
        }
    }
    return Object.assign(tools, Plugin.tools())
}

export default { list }
