/*
界面指令：负责侧边栏、页面导航、设置分类、短时反馈和派生视图数据。
组件只表达用户点了什么，跨页面状态修改集中在这里。
派生视图数据也集中在这里，入口组件只消费不计算。
调用示例：UI.openHome()、UI.toggleSidebar()、UI.openSettings('providers')。
*/
import { computed } from 'vue'                                          // 引入响应式派生计算
import { store } from '../store.js'                                     // 引入唯一工作台数据根
import { Settings } from './settings.js'                                // 引入离开设置时的自动保存动作
import { t } from '../i18n.js'                                          // 引入当前语言反馈文案

let toastTimer = null                                                    // 同一时间只保留一条全局反馈计时器


// --- 派生视图数据：侧边栏已打开会话列表 ---
export const openedConversations = computed(() => {
  return store.ui.openedSessionIDs.map(id => store.sessions[id]).filter(Boolean) // 只展示已加载的完整会话
})


// --- 派生视图数据：主页工作区摘要列表 ---
export const homeWorkspaces = computed(() => {
  return store.workspaces.map(workspace => ({
    id: workspace.id,                                                    // 列表选择身份
    name: workspace.name || workspace.path,                              // 显示名优先使用名称，否则回退路径
    description: workspace.path,                                         // 副标题展示完整路径
  }))
})


// --- 派生视图数据：按工作区分组的会话摘要 ---
export const conversationsByWorkspace = computed(() => {
  return Object.fromEntries(store.workspaces.map(workspace => [
    workspace.id,                                                        // 以工作区 ID 为键
    [{ group: '会话', items: (workspace.sessions || []).map(session => ({
      id: session.id,                                                    // 会话身份
      title: session.title || '新对话',                                   // 空标题使用默认文案
      time: '',                                                          // 时间留空由后续格式化
    })) }],
  ]))
})


// --- 派生视图数据：当前活跃会话 ---
export const activeSession = computed(() => {
  return store.sessions[store.ui.activeSessionID] || null                 // 对话页消费当前选中的完整会话
})


// --- 派生视图数据：模型选择器可选模型 ---
export const activeModels = computed(() => {
  return store.config.providers[store.config.activeProvider]?.models || [] // 从当前供应商配置读取模型列表
})


// --- 离开当前页面 ---
async function leaveCurrentView() {
  if (store.ui.view !== 'settings') return true                     // 非设置页无需执行保存
  return Settings.save()                                            // 等待设置真实持久化后再导航
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
  collapseSidebarOnMobile()                                          // 移动端优先展示对话内容
  return true                                                        // 反馈导航完成
}


// --- 打开设置页 ---
async function openSettings(section = 'providers') {
  if (store.ui.view !== 'settings') Settings.open()                  // 首次进入时创建隔离草稿
  store.ui.settingsSection = section                                 // 选择对应设置项
  store.ui.view = 'settings'                                         // 显示设置主页面
  collapseSidebarOnMobile()                                          // 移动端优先展示设置内容
  return true                                                        // 反馈设置页已经打开
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
  toastTimer = window.setTimeout(() => { store.ui.toast = '' }, 1800) // 1800ms 兼顾阅读完成和节奏紧凑，比 2 秒更快收回视觉焦点
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


// --- 移动端导航后收起侧边栏 ---
function collapseSidebarOnMobile() {
  if (window.innerWidth <= 760) store.ui.sidebarOpen = false         // 窄屏优先展示主内容区域
}


export const UI = { openHome, openChat, openSettings, toggleSidebar, setSearch, notify, copy } // 暴露全部界面动作
