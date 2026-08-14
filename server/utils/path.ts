/*
Agent 数据路径：所有落盘位置都从 AGENT_HOME 推导，测试和嵌入时可以完整隔离。
调用示例：Path.session(id)、Path.messages(id)、Path.workspaceTools(workspacePath)。
*/
import { homedir } from 'node:os'
import { join } from 'node:path'

const root = () => process.env.AGENT_HOME || join(homedir(), '.agent')
const config = () => join(root(), 'config.json')
const workspaces = () => join(root(), 'workspaces.json')
const sessions = () => join(root(), 'sessions')
const session = (sessionID: string) => join(sessions(), sessionID)
const metadata = (sessionID: string) => join(session(sessionID), 'meta.json')
const messages = (sessionID: string) => join(session(sessionID), 'messages.jsonl')
const checkpoints = (sessionID: string) => join(session(sessionID), 'checkpoints.jsonl')
const snapshots = (sessionID: string) => join(session(sessionID), 'snapshots')
const rollback = (sessionID: string) => join(session(sessionID), 'rollback.json')
const plugins = () => join(root(), 'plugins')
const tools = () => join(root(), 'tools')
const workspaceTools = (workspacePath: string) => join(workspacePath, '.agent', 'tools')

export default {
    root,
    config,
    workspaces,
    sessions,
    session,
    metadata,
    messages,
    checkpoints,
    snapshots,
    rollback,
    plugins,
    tools,
    workspaceTools,
}
