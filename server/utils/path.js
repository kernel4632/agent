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
 *   Path.setSessions(dir)          // 启动时指向自定义会话目录
 *   Path.sessionsPathFile()        // 自定义会话目录的指针文件
 *   Path.sessionsMoveFile()        // 等待重启执行的会话迁移标记
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
 *   Path.samePath(a, b)            // 两个路径是否指向同一位置
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

// --- 当前是否跑在 bun test 里 ---
// BUN_ENV 在测试进程里是 'test'；拿不到时退回看入口脚本名。
const testing = process.env.NODE_ENV === 'test'
    || process.env.BUN_ENV === 'test'
    || /bun-test|\.test\.(js|ts)$/.test(process.argv[1] || '')

const home = () => {
    const dir = locked ?? process.env.AGENT_HOME ?? join(process.env.HOME || process.env.USERPROFILE || homedir(), '.agent')
    // 跑测试时绝不允许落到真实数据目录。漏加 Path.lock 的测试会在这里当场失败，
    // 而不是静悄悄地在 ~/.agent 里留下垃圾会话——那会污染用户真实数据，事后很难分辨。
    if (testing && !locked && !process.env.AGENT_HOME) {
        throw new Error('测试进程没有把数据目录指向临时目录：请在 withHome 里设置 AGENT_HOME 并调 Path.lock(root)')
    }
    return dir
}

// --- 把数据目录锁定下来 ---
// 测试切 AGENT_HOME 时会有后台异步收尾（保存历史、清运行标记）在跑；
// 如果测试已经把它恢复成默认值，那些晚到的写入就落到真实的数据目录里了
// （曾经在 ~/.agent 里留下几十条“继续测试”垃圾会话）。
// 锁定之后，本次进程的路径解析与 process.env 后续怎么改都无关，测试结束前调 unlock 即可。
let locked = null
const lock = dir => { locked = dir; sessionsOverride = '' }
const unlock = () => { locked = null; sessionsOverride = '' }

// --- 用户主目录：识别其他软件的 MCP 配置和技能目录时用 ---
// 测试把 AGENT_DISCOVERY_HOME 指到临时目录，就不会读到真实电脑上的配置。
const userHome = () => process.env.AGENT_DISCOVERY_HOME || homedir()

// --- 两个路径是否指向同一位置：Windows 不区分大小写 ---
const samePath = (first, second) => process.platform === 'win32'
    ? resolve(String(first)).toLowerCase() === resolve(String(second)).toLowerCase()
    : resolve(String(first)) === resolve(String(second))

// --- 全局配置 ---
const config = () => join(home(), 'config.json')
const configBackups = () => join(home(), 'config-backups')

// --- 会话目录：每条会话一个目录，元数据、历史和设置分开放 ---
// 会话数据可以单独放到大容量磁盘；启动时由 Storage.prepare() 读指针并调用 setSessions()。
let sessionsOverride = ''
const setSessions = dir => { sessionsOverride = dir ? resolve(String(dir)) : '' }
const sessionsPathFile = () => join(home(), 'sessions-path.json')
const sessionsMoveFile = () => join(home(), 'sessions-move.json')
const sessionsMoveFailedFile = () => join(home(), 'sessions-move-failed.json')
const sessionGroups = () => join(home(), 'session-groups.json')
const sessions = () => process.env.AGENT_SESSIONS
    ? resolve(process.env.AGENT_SESSIONS)
    : sessionsOverride || join(home(), 'sessions')
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

// --- 后台进程日志：每个进程一个文件，按进程 id 命名 ---
const processes = () => join(home(), 'processes')

// --- 技能：全局目录 + 每个会话当前目录下的 .agent/skills ---
// 开发和测试把 AGENT_HOME 指到临时目录时，全局技能也跟着进去，不会碰到真实用户数据。
const skills = () => process.env.AGENT_SKILLS
    || (process.env.AGENT_HOME ? join(process.env.AGENT_HOME, 'skills') : join(homedir(), '.agents', 'skills'))
const projectSkills = cwd => join(cwd, '.agent', 'skills')

// --- 技能目录状态：用户启用或停用了哪些外部目录、单独禁用了哪些技能 ---
const skillsState = () => join(home(), 'skills.json')

export default {
    root: home,
    lock, unlock,
    userHome,
    samePath,
    config,
    configBackups,
    sessionGroups,
    sessions, setSessions, sessionsPathFile, sessionsMoveFile, sessionsMoveFailedFile, session, meta, history, settings, toolTimings, snapshots, checkpoints,
    tools, modelCatalog, processes, skills, skillsState, projectSkills,
}
