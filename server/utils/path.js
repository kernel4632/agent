/* Agent 数据路径。修改数据目录只需要改 AGENT_HOME。 */
import { join } from 'node:path'

const root = () => process.env.AGENT_HOME || join(process.env.HOME, '.agent')
const config = () => join(root(), 'config.json')
const workspaces = () => join(root(), 'workspaces.json')
const session = id => join(root(), 'sessions', id)
const meta = id => join(session(id), 'meta.json')
const messages = id => join(session(id), 'messages.jsonl')
const undo = id => join(session(id), 'undo')
const undoLog = id => join(session(id), 'undo.jsonl')
const plugins = () => join(root(), 'plugins')
const tools = () => join(root(), 'tools')
const workspaceTools = path => join(path, '.agent', 'tools')

export default { root, config, workspaces, session, meta, messages, undo, undoLog, plugins, tools, workspaceTools }
