/*
 * 数据路径：把业务名称换成磁盘上的位置。
 *
 * 本文件只拼路径，不读也不写文件。用户数据放在 AGENT_HOME，默认 %USERPROFILE%\.agent；
 * 技能是全局数据，默认放在 %USERPROFILE%\.agents\skills，测试可以用 AGENT_SKILLS 指到临时目录。
 * 路径都从代码之外的数据目录出发，换一个目录启动也能找到同一份数据。
 *
 * 调用示例：
 *   Path.root()                    // 数据目录
 *   Path.config()                  // 全局配置
 *   Path.sessions()                // 所有会话目录的父目录
 *   Path.meta('session-1')         // 会话元数据
 *   Path.history('session-1')      // 会话历史
 *   Path.settings('session-1')     // 会话运行设置
 *   Path.toolTimings('session-1')  // 工具开始/结束时间
 *   Path.snapshots('session-1')    // 文件快照备份
 *   Path.checkpoints('session-1')  // 快照清单
 *   Path.tools()                   // 用户自己写的工具目录
 *   Path.modelCatalog()            // models.dev 模型目录缓存
 *   Path.skills()                  // 全局技能目录
 *   Path.skillsState()             // 外部技能目录和禁用名单
 *   Path.userHome()                // 用户主目录，识别本机其他软件留下的配置用
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

const home = () => process.env.AGENT_HOME || join(process.env.HOME || process.env.USERPROFILE || homedir(), '.agent')

// --- 用户主目录：识别其他软件的 MCP 配置和技能目录时用 ---
// 测试把 AGENT_DISCOVERY_HOME 指到临时目录，就不会读到真实电脑上的配置。
const userHome = () => process.env.AGENT_DISCOVERY_HOME || homedir()

// --- 全局配置 ---
const config = () => join(home(), 'config.json')

// --- 会话目录：每条会话一个目录，元数据、历史和设置分开放 ---
const sessions = () => join(home(), 'sessions')
const session = id => join(sessions(), id)
const meta = id => join(session(id), 'meta.json')
const history = id => join(session(id), 'history.json')
const settings = id => join(session(id), 'settings.json')
const toolTimings = id => join(session(id), 'tool-timings.json')
const snapshots = id => join(session(id), 'snapshots')
const checkpoints = id => join(session(id), 'checkpoints.json')

// --- 会不断增加的同类数据，按目录扫描 ---
const tools = () => join(home(), 'tools')
const modelCatalog = () => join(home(), 'cache', 'models-dev.json')

// --- 技能：全局目录 + 每个会话当前目录下的 .agent/skills ---
// 开发和测试把 AGENT_HOME 指到临时目录时，全局技能也跟着进去，不会碰到真实用户数据。
const skills = () => process.env.AGENT_SKILLS
    || (process.env.AGENT_HOME ? join(process.env.AGENT_HOME, 'skills') : join(homedir(), '.agents', 'skills'))
const projectSkills = cwd => join(cwd, '.agent', 'skills')

// --- 技能目录状态：用户启用或停用了哪些外部目录、单独禁用了哪些技能 ---
const skillsState = () => join(home(), 'skills.json')

export default {
    root: home,
    userHome,
    config,
    sessions, session, meta, history, settings, toolTimings, snapshots, checkpoints,
    tools, modelCatalog, skills, skillsState, projectSkills,
}
