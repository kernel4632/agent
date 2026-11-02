/*
入口：挂载 Vue 应用，只在这里引入全局样式、启动数据监听并加载工作区与配置。
调用示例：由 index.html 的 <script type="module" src="/src/main.js"> 自动执行。
*/
import { Settings } from './commands/settings.js'
import { Session } from './commands/session.js'

import { Chat } from './commands/chat.js'
import { createApp, watch } from 'vue'
import './styles/tokens.scss'        // 项目自己的颜色、尺寸和动效变量
import './styles/base.scss'          // 全局重置与可访问性规则
import App from './App.vue'
import { store } from './store.js'

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




startWatchers()
createApp(App).mount('#app')
Promise.all([Session.list(), Settings.load()]).finally(() => { store.ui.isLoading = false })
