/*
入口：挂载 Vue 应用，只在这里引入全局样式、启动数据监听并加载会话列表与配置。
调用示例：由 index.html 的 <script type="module" src="/src/main.js"> 自动执行。
*/
import { Settings } from "./features/settings.js"
import { Session } from "./features/session.js"
import { Extensions } from './features/extensions.js'

import { Chat } from './commands/chat.js'
import { Navigation } from './commands/navigation.js'
import { createApp, watch, ref, computed, reactive, onMounted, onBeforeUnmount, defineComponent, h, nextTick, provide, inject, toRef, toRefs, unref, watchEffect } from 'vue'
import './styles/tokens.scss'        // 项目自己的颜色、尺寸和动效变量
import './styles/base.scss'          // 全局重置与可访问性规则
import App from './App.vue'
import Button from './ui/Button.vue'
import Switch from './ui/Switch.vue'
import Dialog from './ui/Dialog.vue'
import Field from './ui/Field.vue'
import Select from './ui/Select.vue'
import Icon from './ui/Icon.vue'
import Fold from './ui/Fold.vue'
import Checkbox from './ui/Checkbox.vue'
import Tabs from './ui/Tabs.vue'
import SettingsList from './ui/SettingsList.vue'
import SettingsRow from './ui/SettingsRow.vue'
import PathInput from './ui/PathInput.vue'
import Markdown from './ui/Markdown.vue'
import SelectButton from './ui/SelectButton.vue'
import Menu from './ui/Menu.vue'

import { AgentAPI } from './utils/api.js'
import { Notice } from './utils/notice.js'
import { store } from './store.js'
import { readPath, savePath } from './utils/session-view.js'

// 扩展前端代码通过 Blob URL 加载，import { ref } from 'vue' 在浏览器里无法解析；
// 把 Vue API 挂到全局，后端打包时会把 import 替换成从 window.__agent_vue__ 取。
window.__agent_vue__ = { ref, computed, reactive, watch, onMounted, onBeforeUnmount, defineComponent, h, nextTick, provide, inject, toRef, toRefs, unref, watchEffect }

// 把 UI 组件和工具函数挂到全局，扩展前端代码里的 @app/ import 会替换成从这里取
window.__agent_app__ = {
  'ui/Button.vue': Button,
  'ui/Switch.vue': Switch,
  'ui/Dialog.vue': Dialog,
  'ui/Field.vue': Field,
  'ui/Select.vue': Select,
  'ui/Icon.vue': Icon,
  'ui/Fold.vue': Fold,
  'ui/Checkbox.vue': Checkbox,
  'ui/Tabs.vue': Tabs,
  'ui/SettingsList.vue': SettingsList,
  'ui/SettingsRow.vue': SettingsRow,
  'ui/PathInput.vue': PathInput,
  'ui/Markdown.vue': Markdown,
  'ui/SelectButton.vue': SelectButton,
  'ui/Menu.vue': Menu,
  'utils/api.js': AgentAPI,
  'utils/notice.js': Notice,
  'store.js': store,
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
Promise.all([Session.list(), Settings.load(), Extensions.init()])
  .then(restorePath)
  .finally(() => { store.ui.isLoading = false })
