/* 页面导航：离开设置前保存草稿，再改变当前页面；不依赖 Vue 组件。
 * 调用：await Navigation.openHome()；await Navigation.openSettings('providers')。
 */
import { store } from '../store.js' // 视图位置与选中会话
import { Settings } from "../features/settings.js" // 离页前保存
import { Session } from "../features/session.js" // 进入聊天前读取会话
import { savePath } from '../utils/session-view.js' // 刷新后回到同一会话

function saveBasePath() {
  if (store.ui.view === 'chat' && store.ui.activeSessionID) savePath({ view: 'chat', sessionId: store.ui.activeSessionID })
  else savePath({ view: 'home' })
}

function saveSettingsPath() {
  if (!store.ui.settingsOpen) return
  savePath({
    view: 'settings',
    baseView: store.ui.view === 'home' ? 'home' : 'chat',
    sessionId: store.ui.activeSessionID || '',
    section: store.ui.settingsSection || '',
    detail: store.ui.settingsDetail || null,
  })
}

async function leaveSettings() {
  if (!store.ui.settingsOpen) return true // 聊天之间切换不用保存设置
  return closeSettings() // 保存失败时继续留在设置页
}

/** 进入尚未建立会话的新对话页。 */
async function openHome() {
  if (!await leaveSettings()) return false // 不丢弃未保存的编辑
  store.ui.view = 'home'
  savePath({ view: 'home' })
  return true
}

/** 读取会话并显示；保存或读取失败都保留原页面。 */
async function openChat(sessionID) {
  if (!await leaveSettings()) return false // 切会话也必须完成离页保存
  const session = await Session.read(sessionID) // 先读取，失败时留在原页
  if (!session) return false
  store.ui.activeSessionID = sessionID
  store.ui.view = 'chat'
  savePath({ view: 'chat', sessionId: sessionID })
  return true
}

/** 打开设置首页或指定面板。 */
async function openSettings(section = '') {
  if (!store.ui.settingsOpen) Settings.open() // 进入时只创建一次隔离草稿
  store.ui.settingsSection = section
  store.ui.settingsDetail = null
  store.ui.settingsOpen = true
  saveSettingsPath()
  return true
}

/** 保存成功才离开设置。 */
async function closeSettings() {
  if (!await Settings.save({ keepDraft: true })) return false
  store.ui.settingsOpen = false
  saveBasePath()
  return true
}

/** 整页滑出后再释放草稿与路径，退出过程中不把详情变成空页面。 */
function finishSettingsClose() {
  if (store.ui.settingsOpen) return // 用户在退场结束前重新打开了设置
  store.settings.draft = null
  store.ui.settingsSection = ''
  store.ui.settingsDetail = null
}

/** 连接错误条的重试操作。 */
async function retry() {
  store.ui.isLoading = true // 请求中禁用需要后端的操作
  try {
    await Settings.load() // 读取成功会清除连接错误
  } finally {
    store.ui.isLoading = false
  }
}

/** 从新对话创建会话并显示；与侧栏打开使用同一个离页规则。 */
async function createSession() {
  if (!await leaveSettings()) return null
  const session = await Session.create()
  if (!session) return null
  store.ui.activeSessionID = session.id
  store.ui.view = 'chat'
  savePath({ view: 'chat', sessionId: session.id })
  return session
}

function openDetail({ id, title = '' } = {}) {
  if (!id) return
  store.ui.settingsDetail = { id, title }
  saveSettingsPath()
}

function closeDetail() {
  store.ui.settingsDetail = null
  saveSettingsPath()
}

function updateDetailTitle(title) {
  if (!store.ui.settingsDetail) return
  store.ui.settingsDetail = { ...store.ui.settingsDetail, title: title || '' }
  saveSettingsPath()
}

export const Navigation = { openHome, openChat, openSettings, closeSettings, finishSettingsClose, retry, createSession, openDetail, closeDetail, updateDetailTitle, saveSettingsPath }
