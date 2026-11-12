/*
入口：挂载 Vue 应用，只在这里引入全局样式、启动数据监听并加载会话列表与配置。
调用示例：由 index.html 的 <script type="module" src="/src/main.js"> 自动执行。
*/
import { Settings } from "./features/settings.js"
import { Session } from "./features/session.js"
import { Extensions } from './features/extensions.js'

import { Chat } from './commands/chat.js'
import { Navigation } from './commands/navigation.js'
import { createApp, watch } from 'vue'
import './styles/tokens.scss'        // 项目自己的颜色、尺寸和动效变量
import './styles/base.scss'          // 全局重置与可访问性规则
import App from './App.vue'
import { store } from './store.js'
import { readPath, savePath } from './utils/session-view.js'
import { AgentAPI } from './utils/api.js'
import { Notice } from './utils/notice.js'

// 扩展前端能 import 的框架模块：'@app/ui/Button.vue' 会映射到这里的 'ui/Button.vue'。
// 用 glob 一次收全 ui/ 下的组件，新增基础组件时不用改这里。
const uiModules = import.meta.glob('./ui/*.vue', { eager: true })
const sharedModules = {
  ...Object.fromEntries(Object.entries(uiModules).map(([path, mod]) => [path.slice(2), mod.default])),
  'utils/api.js': { AgentAPI },
  'utils/notice.js': { Notice },
  'store.js': { store },
}

function startWatchers() {
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
}




// 刷新后回到上次打开的会话或设置页；数据不存在时退回新对话页。
async function restorePath() {
  const saved = readPath()
  if (!saved) return

  const restoreChat = async sessionID => {
    if (!sessionID || !store.sessionList.some(item => item.id === sessionID)) return false
    if (!await Session.read(sessionID)) return false
    store.ui.activeSessionID = sessionID
    store.ui.view = 'chat'
    return true
  }

  if (saved.view === 'settings') {
    if (saved.baseView === 'chat') await restoreChat(saved.sessionId)
    else store.ui.view = 'home'
    await Navigation.openSettings(saved.section || '')
    if (saved.detail) Navigation.openDetail(saved.detail)
    return
  }

  if (saved.view !== 'chat') return
  if (!await restoreChat(saved.sessionId) && !store.ui.errorMessage) savePath({ view: 'home' })
}

startWatchers()
createApp(App).mount('#app')
Promise.all([Session.list(), Settings.load(), Extensions.init(sharedModules)])
  .then(restorePath)
  .finally(() => { store.ui.isLoading = false })
