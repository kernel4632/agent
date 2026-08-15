/* Agent 数据路径。修改数据目录只需要改 AGENT_HOME。 */
import { join } from 'node:path'

const root = () => process.env.AGENT_HOME || join(process.env.HOME, '.agent')

// 配置和工作区索引是 Agent 启动时首先读取的两个文件。
const config = () => join(root(), 'config.json')
const workspaces = () => join(root(), 'workspaces.json')

// 会话目录保存元数据、消息 JSONL 和 checkpoint 快照。
const session = id => join(root(), 'sessions', id)
const meta = id => join(session(id), 'meta.json')
const messages = id => join(session(id), 'messages.jsonl')
const undo = id => join(session(id), 'undo')

// 工具和插件都按目录扫描，删除文件后下一次扫描就不会再发现它。
const plugins = () => join(root(), 'plugins')
const tools = () => join(root(), 'tools')
const workspaceTools = path => join(path, '.agent', 'tools')

export default { root, config, workspaces, session, meta, messages, undo, plugins, tools, workspaceTools }
