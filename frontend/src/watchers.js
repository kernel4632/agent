/*
数据监听：集中处理真正由数据变化自动触发的前端副作用。
包括 SSE 订阅生命周期、视图切换、消息滚动和 Markdown 增强。业务修改继续来自 commands。
主题属性与 M3E token 同步已移到 theme/ThemeProvider.vue，本文件不再接触主题。
每个监听说明：监听什么数据、为什么监听、触发后做什么。
调用示例：startWatchers()
*/
import { watch } from 'vue'                                            // 引入 Vue 响应式监听
import { store } from './store.js'                                    // 引入全局工作台数据，读取活跃会话和视图状态
import { Chat } from './session/chat.js'                             // 引入 SSE 订阅和取消订阅指令


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
}



