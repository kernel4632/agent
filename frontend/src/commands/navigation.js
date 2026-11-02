/* 页面导航：离开设置前保存草稿，再改变当前页面；不依赖 Vue 组件。
 * 调用：await Navigation.openHome()；await Navigation.openSettings('providers')。
 */
import { store } from '../store.js' // 页面位置只有一份
import { Settings } from './settings.js' // 离页保存交给设置功能
import { Config } from './config.js' // 重连时读取后端配置

async function leaveSettings() {
  if (!store.ui.settingsOpen) return true // 聊天之间切换不用保存设置
  return closeSettings() // 保存失败时继续留在设置页
}

/** 进入尚未建立会话的新对话页。 */
async function openHome() {
  if (!await leaveSettings()) return false // 不丢弃未保存的编辑
  store.ui.view = 'home'
  return true
}

/** 将已经读取的会话显示出来。 */
async function openChat(sessionID) {
  if (!await leaveSettings()) return false // 切会话也必须完成离页保存
  store.ui.activeSessionID = sessionID
  store.ui.view = 'chat'
  return true
}

/** 打开设置首页或指定面板。 */
async function openSettings(section = '') {
  if (!store.ui.settingsOpen) Settings.open() // 进入时只创建一次隔离草稿
  store.ui.settingsSection = section
  store.ui.settingsDetail = null
  store.ui.settingsOpen = true
  return true
}

/** 保存成功才离开设置。 */
async function closeSettings() {
  if (!await Settings.save()) return false
  store.ui.settingsOpen = false
  store.ui.settingsDetail = null
  return true
}

/** 连接错误条的重试操作。 */
async function retry() {
  store.ui.isLoading = true // 请求中禁用需要后端的操作
  try {
    await Config.load() // 读取成功会清除连接错误
  } finally {
    store.ui.isLoading = false
  }
}

export const Navigation = { openHome, openChat, openSettings, closeSettings, retry }
