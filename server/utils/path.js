/*
 * Agent 数据路径。
 *
 * 本文件只把业务名称转换为文件路径，不读取、不修改文件。
 * 所有数据文件都从代码所在位置之外的数据目录出发，换一个工作目录启动也能找到同一份数据。
 * 调用示例：
 *   Path.root()                 // 数据目录，默认 %USERPROFILE%\.agent
 *   Path.config()               // 全局配置
 *   Path.meta('session-1')      // 会话元数据
 *   Path.history('session-1')   // 会话历史
 *   Path.tools()                // 用户自己写的工具目录
 */
import { join } from 'node:path' // 使用平台安全的路径拼接。

// 支持测试和容器用 AGENT_HOME 覆盖数据根目录；Windows 用 USERPROFILE 代替 HOME。
const root = () => process.env.AGENT_HOME || join(process.env.HOME || process.env.USERPROFILE, '.agent')

// 全局模型、权限和提示词都写在同一个配置文件里。
const config = () => join(root(), 'config.json')

// 会话目录保存元数据、历史记录和 checkpoint 快照。
const session = id => join(root(), 'sessions', id) // 每条会话使用独立目录。
const meta = id => join(session(id), 'meta.json') // 保存会话模型和工作区元数据。
const history = id => join(session(id), 'history.json') // 保存可编辑的消息历史。

// 用户工具按目录扫描，删除文件后下一次扫描就不会再发现它；内置工具跟着代码走，不在这里。
const tools = () => join(root(), 'tools')

export default { root, config, session, meta, history, tools }
