/*
数据监听：集中处理真正由数据变化自动触发的前端副作用。
包括 SSE 订阅生命周期、消息滚动和 Markdown 增强。业务修改继续来自 commands。
每个监听说明：监听什么数据、为什么监听、触发后做什么。
调用示例：startWatchers()、watchMessages(readMessages, scrollToLatest)。
*/
import { watch, nextTick } from 'vue'                                  // 引入 Vue 响应式监听
import { store } from './store.js'                                    // 引入全局工作台数据，读取活跃会话和视图状态
import { Chat } from './commands/chat.js'                             // 引入 SSE 订阅和取消订阅指令


// --- M3E token 需要同步到 :root 的列表 ---
// M3E 的颜色 token 定义在 m3e-theme shadow DOM 内部，Vue scoped CSS 无法直接访问。
// 通过读取 m3e-theme 的 computedStyle 再写到 document.documentElement，让全局可用。
const M3E_TOKENS = [
  '--md-sys-color-background',
  '--md-sys-color-on-background',
  '--md-sys-color-surface',
  '--md-sys-color-surface-dim',
  '--md-sys-color-surface-bright',
  '--md-sys-color-surface-container-lowest',
  '--md-sys-color-surface-container-low',
  '--md-sys-color-surface-container',
  '--md-sys-color-surface-container-high',
  '--md-sys-color-surface-container-highest',
  '--md-sys-color-on-surface',
  '--md-sys-color-on-surface-variant',
  '--md-sys-color-surface-variant',
  '--md-sys-color-surface-tint',
  '--md-sys-color-inverse-surface',
  '--md-sys-color-inverse-on-surface',
  '--md-sys-color-inverse-primary',
  '--md-sys-color-primary',
  '--md-sys-color-primary-dim',
  '--md-sys-color-on-primary',
  '--md-sys-color-primary-container',
  '--md-sys-color-on-primary-container',
  '--md-sys-color-secondary',
  '--md-sys-color-on-secondary',
  '--md-sys-color-secondary-container',
  '--md-sys-color-on-secondary-container',
  '--md-sys-color-tertiary',
  '--md-sys-color-on-tertiary',
  '--md-sys-color-tertiary-container',
  '--md-sys-color-on-tertiary-container',
  '--md-sys-color-error',
  '--md-sys-color-on-error',
  '--md-sys-color-error-container',
  '--md-sys-color-on-error-container',
  '--md-sys-color-outline',
  '--md-sys-color-outline-variant',
  '--md-sys-color-shadow',
  '--md-sys-color-scrim',
]

// --- 从 m3e-theme 读取 token 并写到 :root ---
function syncM3ETokens() {
  const theme = document.querySelector('m3e-theme')                    // 找到 M3E 主题根元素
  if (!theme) return                                                   // 未挂载时跳过
  const computed = getComputedStyle(theme)                             // 读取 m3e-theme 的计算样式
  const root = document.documentElement                                // 写入目标：:root
  for (const token of M3E_TOKENS) {
    const value = computed.getPropertyValue(token).trim()              // 读取每个 token 的实际值
    if (value) root.style.setProperty(token, value)                    // 有值才写入，避免覆盖空值
  }
}


// --- 启动全局监听 ---
export function startWatchers() {
  // 会话列表由 Server 保存，浏览器不再留副本，所以这里没有"同步到本地"的监听。
  // 监听活跃会话切换：离开旧会话时断开 SSE，进入新会话时建立 SSE
  watch(() => store.ui.activeSessionID, (newID, oldID) => {
    if (oldID && oldID !== newID) Chat.unsubscribe(oldID)             // 离开旧会话时断开事件流
    if (newID && store.ui.view === 'chat') Chat.subscribe(newID)      // 进入新会话时建立事件流
  }, { immediate: true })

  // 监听视图切换：对话页和非对话页之间切换时管理 SSE 连接
  watch(() => store.ui.view, (newView, oldView) => {
    const sessionID = store.ui.activeSessionID                        // 读取当前活跃会话
    if (!sessionID) return                                            // 无活跃会话时无需管理连接
    if (newView === 'chat' && oldView !== 'chat') Chat.subscribe(sessionID) // 切回对话页时重连
    if (newView !== 'chat' && oldView === 'chat') Chat.unsubscribe(sessionID) // 离开对话页时断开
  })

  // 监听主题变化：scheme 切换后 M3E 重新计算颜色，同步到 :root 供 Vue 组件使用
  watch(
    () => store.settings.draft?.appearance ?? store.config.appearance,
    () => nextTick(syncM3ETokens),                                    // DOM 更新后再读取计算值
    { immediate: false },
  )

  // 初始同步：页面加载后等 M3E 完成首次渲染再读取 token
  // 用 requestAnimationFrame 确保 m3e-theme 的 shadow DOM 已经初始化
  const syncOnReady = () => {
    syncM3ETokens()
    // 用 MutationObserver 监听 m3e-theme 的 style 属性变化，确保动态切换时及时同步
    const theme = document.querySelector('m3e-theme')
    if (theme) {
      new MutationObserver(syncM3ETokens).observe(theme, {
        attributes: true,
        attributeFilter: ['scheme', 'color', 'variant', 'contrast'],   // 监听所有影响动态色板的属性
      })
    }
  }
  requestAnimationFrame(() => requestAnimationFrame(syncOnReady))     // 两帧后确保 M3E 已初始化
}


// --- 监听消息时间线变化 ---
export function watchMessages(readMessages, scrollToLatest) {
  return watch(readMessages, scrollToLatest, { deep: true })          // 文本、工具和审批变化后保持最新反馈
}


// --- 监听 Markdown 内容变化 ---
export function watchMarkdownContent(readContent, enhanceContent) {
  return watch(readContent, enhanceContent, { flush: 'post' })        // DOM 写入后增强链接、代码和 Mermaid
}
