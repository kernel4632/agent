/*
 * 会话目录：创建、读取、重命名、删除和设置。完整历史在 features/history.js。
 *
 * 会话列表来自 /session/list；完整历史只在打开会话时由 History.refresh 读取。
 * 页面导航属于 commands/navigation.js，不在这里。
 *
 * 调用示例：
 *   const session = await Session.read(sessionId)
 *   await Session.rename(sessionId, '新标题')
 *   await Session.remove(sessionId)
 */

import { AgentAPI } from '../utils/api.js' // 会话目录接口
import { store } from '../store.js' // 更新当前可见记录和会话摘要
import { Notice } from '../utils/notice.js' // 操作完成或失败的反馈
import { History } from './history.js' // 归一化和历史读取
import { ComposerDraft } from './composer-draft.js' // 删除会话时清理本地草稿
import { DEFAULT_CONTEXT, NEW_SESSION_TITLE } from '../defaults.js' // 默认上下文


// --- 会话列表只来自 /session/list，不再拼装独立工作区 ---
function locate(sessionID) {
  return store.sessionList.find(session => session.id === sessionID)
}


// --- 创建会话 ---
async function create(cwd) {
  try {
    const created = await AgentAPI.createSession(cwd, store.config.activeProvider, store.config.activeModel)
    return History.admit(created)                       // 归一化并登记进响应式目录和列表
  } catch (error) {
    Notice.show(error.message)                            // 反馈真实创建失败原因
    return null                                         // 保持当前页面和目录不变
  }
}


// --- 重命名会话 ---
async function rename(sessionID, title) {
  const cleanTitle = title.trim()                       // 标题不保留首尾空白
  const found = locate(sessionID)                       // 查找摘要归属
  const session = store.sessions[sessionID]             // 查找完整会话
  if (!cleanTitle || !found) return false
  try {
    const result = await AgentAPI.renameSession(sessionID, cleanTitle)
    found.title = result.title                          // 更新侧边栏摘要
    if (session) session.title = result.title
    return true                                         // 标题编辑器退出编辑
  } catch (error) {
    Notice.show(error.message)                            // 保留编辑器内容并显示错误
    return false                                        // 不伪造保存成功
  }
}


// --- 切换当前会话目录；只改 cwd，历史、模型和设置都不动 ---
async function setCwd(sessionID, cwd) {
  const result = await AgentAPI.setSessionCwd(sessionID, cwd)
  const summary = locate(sessionID)
  if (summary) {
    summary.cwd = result.cwd
    summary.temporary = false
  }
  const session = store.sessions[sessionID]
  if (session) {
    session.cwd = result.cwd
    session.temporary = false
  }
  return result
}

// --- 删除会话 ---
function forget(sessionID) {
  const found = locate(sessionID)
  if (!found) return false
  store.sessionList.splice(store.sessionList.indexOf(found), 1)
  delete store.sessions[sessionID]
  void ComposerDraft.remove(sessionID)
  return true
}

async function remove(sessionID) {
  if (!locate(sessionID)) return false
  try {
    await AgentAPI.removeSession(sessionID)
    forget(sessionID)
    if (store.ui.activeSessionID === sessionID) { store.ui.activeSessionID = ''; store.ui.view = 'home' }
    Notice.show('会话已删除')
    return true
  } catch (error) {
    Notice.show(error.message)
    return false
  }
}

// 连续删除：逐个调用已有删除接口，失败的保留并提示，成功的立刻从本地列表移除。
async function removeMany(sessionIDs = []) {
  const ids = [...new Set(sessionIDs)].filter(id => locate(id))
  if (!ids.length) return 0
  const activeRemoved = ids.includes(store.ui.activeSessionID)
  let removed = 0
  for (const sessionID of ids) {
    try {
      await AgentAPI.removeSession(sessionID)
      forget(sessionID)
      removed += 1
    } catch (error) {
      Notice.show(error.message)
    }
  }
  if (removed && activeRemoved) { store.ui.activeSessionID = ''; store.ui.view = 'home' }
  if (removed) Notice.show(`已删除 ${removed} 个会话`)
  return removed
}


// --- 切换会话模型 ---
async function selectModel(sessionID, provider, model) {
  const session = store.sessions[sessionID]
  if (!session) return false
  try {
    const meta = await AgentAPI.setSessionModel(sessionID, provider, model)
    session.provider = meta.provider
    session.model = meta.model
    session.contextLimit = store.config.providers[provider]?.models.find(item => item.id === model)?.context || DEFAULT_CONTEXT
    return true
  } catch (error) {
    Notice.show(error.message)                            // 服务端错误直接展示
    return false
  }
}


// --- 改会话运行设置 ---
async function saveSettings(sessionID, change) {
  const session = store.sessions[sessionID]
  if (!session) return null
  // 控件会先亮起来；失败时用这份快照还原，避免界面停在一个后端没接受的值上。
  const previous = session.settings
  const next = { ...previous, ...change }
  session.settings = next
  try {
    const settings = await AgentAPI.saveSettings(sessionID, change)
    // 读取历史可能已经替换会话对象，响应必须写到当前对象，不能写回过期引用。
    const current = store.sessions[sessionID]
    if (current) current.settings = settings
    return settings
  } catch (error) {
    const current = store.sessions[sessionID]
    if (current) current.settings = previous
    Notice.show(error.message)
    return null
  }
}


// --- 改思考强度 ---
// 七档和界面滑块共用；写错的值后端会退回原值。
async function setReasoning(sessionID, reasoning) {
  const session = store.sessions[sessionID]
  if (!session) return null
  return saveSettings(sessionID, { reasoning })
}


/** 读取并登记会话；导航和当前页面由 Navigation 决定。 */
async function read(id) {
  const sessionID = id.trim()
  if (!/^[\w-]+$/.test(sessionID)) { Notice.show('请输入有效的会话 ID'); return false }
  try {
    const session = await History.refresh(sessionID, { showLoading: true })
    const found = locate(sessionID)
    if (!session.title && found) session.title = found.title
    if (!found) store.sessionList.unshift(History.summaryOf(session))
    return session
  } catch (error) { Notice.show(error.message); return false }
}


// --- 加载会话列表 ---
async function list() {
  try {
    const sessions = await AgentAPI.getSessionList()
    store.sessionList = sessions.map(serverSummaryOf) // 空列表就是还没有会话，不依赖工作区初始化
    return true
  } catch (error) {
    // 启动时后端没起来不该在控制台留下未处理的 rejection；用可见的错误提示代替。
    store.ui.errorMessage = error.message
    return false
  }
}

// --- 重新加载会话列表 ---
async function reload() {
  const sessions = await AgentAPI.getSessionList()
  store.sessionList = sessions.map(serverSummaryOf)
  return true
}

// --- 把 Server 会话转换成列表摘要 ---
function serverSummaryOf(session) {
  return {
    id: session.id,
    cwd: session.cwd,
    temporary: session.temporary === true,
    title: session.title || NEW_SESSION_TITLE,
    provider: session.provider,
    model: session.model,
    messageCount: session.messageCount ?? 0,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }
}

export const Session = { locate, list, reload, create, read, rename, remove, removeMany, selectModel, saveSettings, setReasoning, setCwd }
