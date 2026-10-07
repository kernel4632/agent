/*
Workspace 指令：从 Server 读取会话列表，组装成主页和侧边栏要的工作区结构。

Server 是会话的唯一来源；浏览器只保留"哪些会话被打开过"这类纯界面偏好。
调用示例：await Workspace.load()、await Workspace.reload()。
*/
import { AgentAPI } from '../api.js'
import { store } from '../store.js'

// 浏览器只记住用户打开过哪个工作区，会话本身一律问 Server 要。
const ACTIVE_WORKSPACE_KEY = 'la.active-workspace.v1'

// --- 读取当前工作区标识 ---
function activeWorkspaceID() {
  try { return localStorage.getItem(ACTIVE_WORKSPACE_KEY) || '' } catch { return '' }
}

// --- 记住当前工作区 ---
function rememberWorkspace(id) {
  try { localStorage.setItem(ACTIVE_WORKSPACE_KEY, id) } catch { /* 存不下不影响使用。 */ }
}

// --- 加载会话列表 ---
async function load() {
  const reading = [AgentAPI.getSessionList(), AgentAPI.getWorkspace().catch(() => null)]
  const [sessions, workspace] = await Promise.all(reading)

  const id = workspace?.path || 'local'
  // 会话按 Server 的记录组装；一条都没有时列表是空的，这是真实状态，不造假数据。
  store.workspaces.splice(0, store.workspaces.length, {
    id,
    name: workspace?.path?.split(/[/\\]/).filter(Boolean).pop() || '本机会话',
    path: workspace?.path || '',
    git: workspace?.git || null,
    sessions: sessions.map(summaryOf),
  })
  store.ui.activeWorkspaceID = id
  rememberWorkspace(id)
  return true
}

// --- 重新加载会话列表 ---
async function reload() {
  const sessions = await AgentAPI.getSessionList()
  const current = store.workspaces[0]
  if (!current) return load()
  current.sessions = sessions.map(summaryOf)
  return true
}

// --- 把 Server 会话转换成列表摘要 ---
function summaryOf(session) {
  return {
    id: session.id,
    title: session.title || '未命名会话',
    provider: session.provider,
    model: session.model,
    messageCount: session.messageCount ?? 0,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }
}

export const Workspace = { load, reload, activeWorkspaceID, rememberWorkspace }
