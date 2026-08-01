/*
界面指令：负责侧边栏、页面导航、设置分类和短时反馈。
组件只表达用户点了什么，跨页面状态修改集中在这里。
调用示例：UI.openHome()、UI.toggleSidebar()、UI.openSettings('providers')。
*/
import { store } from '../store.js'                                 // 引入唯一工作台数据根
import { Settings } from './settings.js'                            // 引入离开设置时的自动保存动作
import { t } from '../i18n.js'                                      // 引入当前语言反馈文案

let toastTimer = null                                                // 同一时间只保留一条全局反馈计时器


// --- 离开当前页面 ---
function leaveCurrentView() {
  if (store.ui.view === 'settings') Settings.save()                 // 设置页离开时自动提交本地草稿
}


// --- 打开主页 ---
function openHome() {
  leaveCurrentView()                                                 // 先保存当前设置草稿
  store.ui.view = 'home'                                             // 再反馈主页内容
}


// --- 打开对话页 ---
function openChat(sessionID) {
  leaveCurrentView()                                                 // 从设置进入会话前保存草稿
  store.ui.activeSessionID = sessionID                               // 先固定目标 Session
  store.ui.view = 'chat'                                             // 再显示对话页
}


// --- 打开设置页 ---
function openSettings(section = 'providers') {
  if (store.ui.view !== 'settings') Settings.open()                  // 首次进入时创建隔离草稿
  store.ui.settingsSection = section                                 // 选择对应设置项
  store.ui.view = 'settings'                                         // 显示设置主页面
}


// --- 展开或收起侧边栏 ---
function toggleSidebar(force) {
  store.ui.sidebarOpen = typeof force === 'boolean' ? force : !store.ui.sidebarOpen // 显式值和按钮切换共用动作
}


// --- 修改主页搜索文本 ---
function setSearch(value) {
  store.ui.search = value                                            // Workspace 和 Session 结果自动跟随筛选
}


// --- 展示短时反馈 ---
function notify(message) {
  store.ui.toast = message                                           // 立即展示用户动作结果
  window.clearTimeout(toastTimer)                                    // 新反馈取代旧计时器
  toastTimer = window.setTimeout(() => { store.ui.toast = '' }, 1800) // 短暂显示后自动清理
}


// --- 复制文本 ---
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)                         // 浏览器剪贴板完成真实前端副作用
    notify(t('copied'))                                               // 原位外的轻提示不打断阅读
    return true                                                       // 反馈调用方复制成功
  } catch {
    notify(t('copyFailed'))                                           // 权限受限时给出明确反馈
    return false                                                      // 反馈调用方复制失败
  }
}


export const UI = { openHome, openChat, openSettings, toggleSidebar, setSearch, notify, copy } // 暴露全部界面动作
