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
 *   Path.snapshots('session-1')    // 文件快照备份
 *   Path.checkpoints('session-1')  // 快照清单
 *   Path.tools()                   // 用户自己写的工具目录
 *   Path.skills()                  // 全局技能目录
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

const home = () => process.env.AGENT_HOME || join(process.env.HOME || process.env.USERPROFILE || homedir(), '.agent')

// --- 全局配置 ---
const config = () => join(home(), 'config.json')

// --- 会话目录：每条会话一个目录，元数据、历史和设置分开放 ---
const sessions = () => join(home(), 'sessions')
const session = id => join(sessions(), id)
const meta = id => join(session(id), 'meta.json')
const history = id => join(session(id), 'history.json')
const settings = id => join(session(id), 'settings.json')
const snapshots = id => join(session(id), 'snapshots')
const checkpoints = id => join(session(id), 'checkpoints.json')

// --- 会不断增加的同类数据，按目录扫描 ---
const tools = () => join(home(), 'tools')

// --- 技能：全局目录 + 每个会话当前目录下的 .agent/skills ---
// 开发和测试把 AGENT_HOME 指到临时目录时，全局技能也跟着进去，不会碰到真实用户数据。
const skills = () => process.env.AGENT_SKILLS
    || (process.env.AGENT_HOME ? join(process.env.AGENT_HOME, 'skills') : join(homedir(), '.agents', 'skills'))
const projectSkills = cwd => join(cwd, '.agent', 'skills')

export default {
    root: home,
    config,
    sessions, session, meta, history, settings, snapshots, checkpoints,
    tools, skills, projectSkills,
}
