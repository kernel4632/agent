/* Agent 数据路径。修改数据目录只需要改 AGENT_HOME。 */
import { join } from 'node:path' // 使用平台安全的路径拼接。

const root = () => process.env.AGENT_HOME || join(process.env.HOME || process.env.USERPROFILE, '.agent') // 支持测试和容器覆盖数据根目录；Windows 使用 USERPROFILE 替代 HOME。

// 配置和工作区索引是 Agent 启动时首先读取的两个文件。
const config = () => join(root(), 'config.json') // 全局模型、权限和插件配置。
const workspaces = () => join(root(), 'workspaces.json') // 工作区与会话摘要索引。

// 会话目录保存元数据、消息 JSONL 和 checkpoint 快照。
const session = id => join(root(), 'sessions', id) // 每条会话使用独立目录。
const meta = id => join(session(id), 'meta.json') // 保存会话模型和工作区元数据。
const messages = id => join(session(id), 'messages.jsonl') // 保存可编辑的消息历史。

// 工具和插件都按目录扫描，删除文件后下一次扫描就不会再发现它。
const tools = () => join(root(), 'tools') // 用户安装的全局工具目录。

export default { root, config, workspaces, session, meta, messages, tools } // 导出全部路径语义。
