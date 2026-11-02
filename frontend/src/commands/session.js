/*
Session 指令：负责创建、读取、打开、重命名、删除和切换会话模型。
Server 会话会被归一化为现有 页面组件可直接渲染的消息与工具结构。
调用示例：await Session.create(workspaceID)、await Session.read(sessionID)；页面导航调用 Navigation。
*/
import { Notice } from './notice.js'
import { History } from './history.js'
import { AgentAPI } from '../utils/api.js'
import { store } from '../store.js'
import { t } from '../utils/i18n.js'
import { COMPACT_RANGE, DEFAULT_CONTEXT, DEFAULT_SETTINGS, NEW_SESSION_TITLE } from '../defaults.js'


// --- 查找会话摘要和所属工作区 ---
function locate(sessionID) {
  for (const workspace of store.workspaces) {
    const summary = workspace.sessions.find((session) => session.id === sessionID) // 在工作区摘要中查找
    if (summary) return { workspace, summary }          // 返回后续修改需要的同一引用
  }
  return null                                           // 未找到时由调用动作决定反馈
}


// --- 记录已打开会话 ---
function rememberOpened(sessionID) {
  const previousIndex = store.ui.openedSessionIDs.indexOf(sessionID) // 查找会话是否已经出现在侧边栏
  if (previousIndex >= 0) store.ui.openedSessionIDs.splice(previousIndex, 1) // 再次打开时先移除旧位置
  store.ui.openedSessionIDs.unshift(sessionID)                        // 最近打开的会话放在侧边栏最前
}


// --- 创建会话 ---
async function create(workspaceID = store.ui.activeWorkspaceID) {
  const workspace = store.workspaces.find((item) => item.id === workspaceID) || store.workspaces[0] // 没有选择时使用首个工作区
  if (!workspace) return null                           // 没有工作区时不能创建归属不明的会话
  try {
    const created = await AgentAPI.createSession(workspace.id, store.config.activeProvider, store.config.activeModel) // Server 创建并持久化完整会话
    const session = History.normalize(created)                  // 补齐仅前端使用的草稿和用量字段
    store.sessions[session.id] = session                // 完整会话进入响应式目录
    workspace.sessions.unshift(History.summaryOf(session))      // 摘要进入当前工作区首位
    rememberOpened(session.id)                          // 新会话已经加载，应立即出现在侧边栏
    return session                                      // 返回新会话供组合动作使用
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
    found.summary.title = result.title                  // 更新侧边栏和主页摘要
    if (session) session.title = result.title
    const tab = store.tabs.items.find(item => item.sessionID === sessionID)
    if (tab) Tabs.setTitle(tab.key, result.title)
    return true                                         // 标题编辑器退出编辑
  } catch (error) {
    Notice.show(error.message)                            // 保留编辑器内容并显示错误
    return false                                        // 不伪造保存成功
  }
}


// --- 删除会话 ---
function forget(sessionID) {
  const found = locate(sessionID)
  if (!found) return false
  found.workspace.sessions.splice(found.workspace.sessions.indexOf(found.summary), 1)
  delete store.sessions[sessionID]
  const openedIndex = store.ui.openedSessionIDs.indexOf(sessionID)
  if (openedIndex >= 0) store.ui.openedSessionIDs.splice(openedIndex, 1)
  Tabs.removeSession(sessionID)
  return true
}

async function remove(sessionID) {
  if (!locate(sessionID)) return false
  try {
    await AgentAPI.removeSession(sessionID)
    forget(sessionID)
    if (store.ui.activeSessionID === sessionID) { store.ui.activeSessionID = ''; store.ui.view = 'home' }
    Notice.show(t('sessionDeleted'))
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
    session.contextLimit = store.config.providers[provider]?.modelSettings?.[model]?.context || session.contextLimit || DEFAULT_CONTEXT
    Notice.show(`已切到 ${meta.model}`)
    return true
  } catch (error) {
    Notice.show(error.message)                            // 运行中冲突等错误直接展示
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
  if (change.capabilities) next.capabilities = { ...previous.capabilities, ...change.capabilities }
  if (change.uses) next.uses = { ...previous.uses, ...change.uses }
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


// --- 直接切到指定智能体（输入框上的智能体抽屉用） ---
async function setAgent(sessionID, agent) {
  const session = store.sessions[sessionID]
  if (!session) return null
  const agents = store.config.agents || []
  const next = agents.find(item => item.name === agent)
  if (!next) return null
  if (session.settings.agent === next.name) return session.settings
  const settings = await saveSettings(sessionID, { agent: next.name })
  // 切到只读智能体时要说清会发生什么，不然用户会疑惑"工具怎么少了一半"。
  if (settings) Notice.show(next.readOnly ? `已切到${next.label}：只保留只读工具` : `已切到${next.label}`)
  return settings
}


// --- 智能体在界面上叫什么 ---
function agentLabel(name) {
  return (store.config.agents || []).find(item => item.name === name)?.label || name
}


// --- 切换一项模型能力开关 ---
async function toggleCapability(sessionID, name) {
  const session = store.sessions[sessionID]
  if (!session) return null
  return saveSettings(sessionID, { capabilities: { [name]: !session.settings.capabilities[name] } })
}


// --- 切换自动生成标题 ---
async function toggleAutoTitle(sessionID) {
  const session = store.sessions[sessionID]
  if (!session) return null
  const next = !session.settings.autoTitle
  return saveSettings(sessionID, { autoTitle: next })
}


// --- 改某一件事用的模型 ---
// target 传 null 表示改回和主模型共用（后端认这个意思）。
async function setUse(sessionID, use, target) {
  const session = store.sessions[sessionID]
  if (!session) return null
  // 只提交点名的这一件事，另外两件后端会保持原样。
  const settings = await saveSettings(sessionID, { uses: { [use]: target } })
  if (settings) Notice.show(target ? `「${useLabel(use)}」改用 ${target.model}` : `「${useLabel(use)}」改回和主模型共用`)
  return settings
}


// --- 改思考强度 ---
// 七档和界面滑块共用；写错的值后端会退回原值。
async function setReasoning(sessionID, reasoning) {
  const session = store.sessions[sessionID]
  if (!session) return null
  return saveSettings(sessionID, { reasoning })
}


// --- 改自动压缩阈值 ---
async function setCompactThreshold(sessionID, value) {
  const session = store.sessions[sessionID]
  if (!session) return null
  const threshold = Math.min(COMPACT_RANGE.max, Math.max(COMPACT_RANGE.min, Number(value) || DEFAULT_SETTINGS.compactThreshold))
  return saveSettings(sessionID, { compactThreshold: threshold })
}


// --- 用途的中文名 ---
const useLabel = use => (store.config.useOptions || []).find(item => item.use === use)?.label || use

/** 读取并登记会话；导航和当前页面由 Navigation 决定。 */
async function read(id) {
  const sessionID = id.trim()
  if (!/^[\w-]+$/.test(sessionID)) { Notice.show('请输入有效的会话 ID'); return false }
  try {
    const source = await AgentAPI.getSession(sessionID)
    const found = locate(sessionID)
    if (!source.title && found) source.title = found.summary.title
    const session = History.normalize(source, store.sessions[sessionID])
    if (!locate(sessionID)) store.workspaces[0].sessions.unshift(History.summaryOf(session))
    store.sessions[sessionID] = session
    rememberOpened(sessionID)
    Tabs.openSession(sessionID, session.title || NEW_SESSION_TITLE)
    if (found) store.ui.activeWorkspaceID = found.workspace.id
    return session
  } catch (error) { Notice.show(error.message); return false }
}


// --- 加载会话列表 ---
async function list() {
  try {
    const reading = [AgentAPI.getSessionList(), AgentAPI.getWorkspace().catch(() => null)]
    const [sessions, workspace] = await Promise.all(reading)

    const id = workspace?.path || 'local'
    // 会话按 Server 的记录组装；一条都没有时列表是空的，这是真实状态，不造假数据。
    store.workspaces.splice(0, store.workspaces.length, {
      id,
      name: workspace?.path?.split(/[/\\]/).filter(Boolean).pop() || '本机会话',
      path: workspace?.path || '',
      git: workspace?.git || null,
      files: Array.isArray(workspace?.files) ? workspace.files : [],
      sessions: sessions.map(summaryOf),
    })
    store.ui.activeWorkspaceID = id
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
  const current = store.workspaces[0]
  if (!current) return list()
  current.sessions = sessions.map(summaryOf)
  return true
}

// --- 把 Server 会话转换成列表摘要 ---
function summaryOf(session) {
  return {
    id: session.id,
    title: session.title || NEW_SESSION_TITLE,
    provider: session.provider,
    model: session.model,
    messageCount: session.messageCount ?? 0,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }
}

// --- 创建一个草稿标签 ---
function createDraft() {
  const tabStore = store.tabs                            // 读取当前标签顺序
  const key = `draft:${crypto.randomUUID()}`             // 为独立输入上下文生成稳定身份
  tabStore.items.push({ key, sessionID: '', title: '新会话' }) // 将草稿加入顶部工作区
  tabStore.activeKey = key                               // 新草稿立即成为当前标签
  return key                                             // 返回身份供对话指令建立数据
}

// --- 打开一个已有会话标签 ---
function openSession(sessionID, title = NEW_SESSION_TITLE, activate = true) {
  const tabStore = store.tabs                            // 读取当前标签顺序
  const key = `session:${sessionID}`                     // 将会话 ID 转换为稳定标签身份
  if (!tabStore.items.some((tab) => tab.key === key)) tabStore.items.push({ key, sessionID, title }) // 已打开时不重复添加
  if (activate) tabStore.activeKey = key                 // 前台打开时切换当前选择
  return key                                             // 返回身份供对话指令定位数据
}

// --- 将草稿升级为真实会话标签 ---
function promote(draftKey, sessionID) {
  const tabStore = store.tabs                            // 读取草稿标签和当前选择
  const tab = tabStore.items.find((item) => item.key === draftKey) // 查找收到 Server 会话 ID 的草稿
  const nextKey = `session:${sessionID}`                 // 创建可持久化的真实标签身份
  if (!tab) return nextKey                               // 标签已关闭时仍允许后台流完成

  tab.key = nextKey                                      // 原位升级以保持标签顺序
  tab.sessionID = sessionID                              // 保存后续重新读取所需的会话 ID
  if (tabStore.activeKey === draftKey) tabStore.activeKey = nextKey // 当前草稿继续保持选中
  return nextKey                                         // 返回新身份供对话映射迁移
}

// --- 选择一个已打开标签 ---
function select(key) {
  const tabStore = store.tabs                            // 读取当前标签集合
  if (!tabStore.items.some((tab) => tab.key === key)) return // 不存在的标签不能成为当前选择
  tabStore.activeKey = key                               // 将聊天页切换到目标标签
}

// --- 关闭标签并选择相邻项 ---
function close(key) {
  const tabStore = store.tabs                            // 读取当前标签顺序和选择
  const index = tabStore.items.findIndex((tab) => tab.key === key) // 定位关闭项和邻居位置
  if (index < 0) return tabStore.activeKey               // 标签不存在时保持当前选择
  const wasActive = tabStore.activeKey === key           // 记录是否需要选择邻居
  tabStore.items.splice(index, 1)                        // 从顶部工作区移除目标标签
  if (wasActive) tabStore.activeKey = tabStore.items[index]?.key ?? tabStore.items[index - 1]?.key ?? '' // 优先选择右侧邻居
  return tabStore.activeKey                              // 返回关闭后的当前标签
}

// --- 更新一个标签标题 ---
function setTitle(key, title) {
  const tabStore = store.tabs                            // 读取当前标签集合
  const tab = tabStore.items.find((item) => item.key === key) // 定位需要更新的标签
  if (!tab || !title) return                             // 无目标或空标题时保持现状
  tab.title = title                                      // 将 Server 最终标题写入顶部反馈
}

// --- 用会话摘要同步全部标题 ---
function syncTitles(sessions) {
  const tabStore = store.tabs                            // 读取所有已打开标签
  tabStore.items.forEach((tab) => {
    const session = sessions.find((item) => item.id === tab.sessionID) // 查找标签对应的最新摘要
    if (session?.title) tab.title = session.title        // 异步标题生成后更新标签反馈
  })
}

// --- 删除会话关联标签 ---
function removeSession(sessionID) {
  const tabStore = store.tabs                            // 读取所有已打开标签
  const tab = tabStore.items.find((item) => item.sessionID === sessionID) // 查找被删除会话的标签
  if (tab) close(tab.key)                                // 复用相邻选择规则移除标签
}

export const Tabs = {  createDraft, openSession, promote, select, close, setTitle, syncTitles, removeSession  }
export const Session = { locate, list, reload, create, read, rename, remove, removeMany, selectModel, saveSettings, setAgent, agentLabel, toggleCapability, toggleAutoTitle, setUse, setCompactThreshold, setReasoning }
