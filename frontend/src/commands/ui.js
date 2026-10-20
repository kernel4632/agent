/*
界面指令：负责页面导航、设置开关、短时反馈和当前会话派生数据。
组件只表达用户点了什么，跨页面状态修改集中在这里。
派生视图数据也集中在这里，入口组件只消费不计算。
调用示例：UI.openHome()、UI.openChat(id)、UI.openSettings()、UI.notify('已保存')。
*/
import { computed } from 'vue'                                          // 引入响应式派生计算
import { store } from '../store.js'                                     // 引入唯一工作台数据根
import { Settings } from './settings.js'                                // 引入离开设置时的自动保存动作
import { t } from '../i18n.js'                                          // 引入当前语言反馈文案

let toastTimer = null                                                    // 同一时间只保留一条全局反馈计时器


// --- 派生视图数据：当前活跃会话 ---
export const activeSession = computed(() => {
  return store.sessions[store.ui.activeSessionID] || null                 // 对话页消费当前选中的完整会话
})


// --- 离开当前页面 ---
async function leaveCurrentView() {
  if (!store.ui.settingsOpen) return true
  return closeSettings()
}


// --- 打开主页 ---
async function openHome() {
  if (!await leaveCurrentView()) return false                        // 保存失败时保留设置页和草稿
  store.ui.view = 'home'                                             // 再反馈主页内容
  return true                                                        // 反馈导航完成
}


// --- 打开对话页 ---
async function openChat(sessionID) {
  if (!await leaveCurrentView()) return false                        // 保存失败时不离开设置页
  store.ui.activeSessionID = sessionID                               // 先固定目标 Session
  store.ui.view = 'chat'                                             // 再显示对话页
  return true                                                        // 反馈导航完成
}


// --- 打开设置页 ---
async function openSettings(section = 'appearance') {
  if (!store.ui.settingsOpen) Settings.open()
  store.ui.settingsSection = typeof section === 'string' ? section : 'appearance'
  store.ui.settingsOpen = true
  return true
}

async function closeSettings() {
  if (!await Settings.save()) return false
  store.ui.settingsOpen = false
  return true
}


// --- 展示短时反馈 ---
function notify(message) {
  store.ui.toast = message                                           // 立即展示用户动作结果
  window.clearTimeout(toastTimer)                                    // 新反馈取代旧计时器
  toastTimer = window.setTimeout(() => { store.ui.toast = '' }, 5000)
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


export const UI = { openHome, openChat, openSettings, closeSettings, notify, copy }
