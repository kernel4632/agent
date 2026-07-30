<!--
应用壳层：提供 OpenCode 式固定顶部标签栏，并在主页、会话、工具和设置之间切换。
顶部标签只触发导航；会话读取交给 stores，业务页面只消费当前上下文。
调用示例：createApp(App).mount('#app')。
-->
<script setup>
import { onMounted } from 'vue'                       // 引入应用启动数据恢复能力
import Chat from './views/Chat.vue'                   // 引入当前标签对话工作区
import Sessions from './views/Sessions.vue'           // 引入独立主页会话选择区
import Settings from './views/Settings.vue'           // 引入配置管理区
import Tools from './views/Tools.vue'                 // 引入工具注册表区
import { useChatStore } from './stores/chat.js'       // 引入按标签对话上下文
import { useSessionStore } from './stores/session.js' // 引入会话摘要和详情指令
import { useTabStore } from './stores/tabs.js'        // 引入顶部多会话标签状态
import { useUIStore } from './stores/ui.js'           // 引入主页和业务视图导航

const chat = useChatStore()                           // 读取按标签隔离的聊天数据
const sessions = useSessionStore()                    // 读取 Server 会话摘要
const tabs = useTabStore()                            // 读取持久化顶部标签
const ui = useUIStore()                               // 读取当前页面


// --- 打开独立主页 ---
function openHome() {
  ui.openView('home')                                 // 保留标签但将主区域切回会话选择页
}


// --- 创建新的草稿标签 ---
function startNewChat() {
  const key = tabs.createDraft()                      // 先建立独立顶部标签身份
  chat.loadSession(null, key)                         // 再建立对应空消息和输入上下文
  ui.openView('chat')                                 // 最后反馈可输入对话页
}


// --- 打开一个会话标签 ---
async function openSession(sessionID, activate = true) {
  const summary = sessions.sessions.find((item) => item.id === sessionID) // 读取当前标题供标签立即展示
  const key = tabs.openSession(sessionID, summary?.title, activate) // 新增或复用顶部标签
  if (!activate) return                               // 后台打开不切换当前内容
  ui.openView('chat')                                 // 先反馈标签选择
  if (chat.hasConversation(key)) return               // 已加载上下文保留滚动和流状态
  const session = await sessions.select(sessionID)    // 首次打开读取完整 Server 历史
  if (session) chat.loadSession(session, key)         // 将详情写入准确标签上下文
}


// --- 选择已打开标签 ---
async function selectTab(tab) {
  tabs.select(tab.key)                                // 修改顶部活动状态
  ui.openView('chat')                                 // 从主页或设置回到对话页
  if (!tab.sessionID || chat.hasConversation(tab.key)) return // 草稿或已加载标签无需请求
  const session = await sessions.select(tab.sessionID) // 读取尚未加载的历史
  if (session) chat.loadSession(session, tab.key)      // 写入点击时对应标签
}


// --- 关闭一个顶部标签 ---
async function closeTab(event, tab) {
  event.stopPropagation()                             // 关闭按钮不触发标签选择
  if (!chat.removeConversation(tab.key)) return       // 运行中会话保留停止和审批入口
  const nextKey = tabs.close(tab.key)                 // 移除标签并选择相邻项
  if (!nextKey) return openHome()                     // 最后一个标签关闭后回主页
  const nextTab = tabs.tabs.find((item) => item.key === nextKey) // 查找新活动项
  if (nextTab) await selectTab(nextTab)               // 保证未加载历史也能正确显示
}


// --- 删除主页会话 ---
async function removeSession(sessionID) {
  const removed = await sessions.remove(sessionID)    // 删除 Server 会话和磁盘记录
  if (!removed) return                                // 失败时保留标签和列表
  const tab = tabs.tabs.find((item) => item.sessionID === sessionID) // 查找关联标签
  if (tab) chat.removeConversation(tab.key)           // 释放非运行上下文
  tabs.removeSession(sessionID)                       // 从顶部工作区移除标签
}


// --- 打开工具或设置页面 ---
function openUtility(viewName) {
  ui.openView(viewName)                               // 顶部会话标签保留，便于随时返回
}


onMounted(async () => {
  await sessions.refresh()                            // 启动时读取真实会话摘要
  tabs.syncTitles(sessions.sessions)                  // 更新恢复标签的异步标题
  const activeTab = tabs.tabs.find((tab) => tab.key === tabs.activeKey) // 查找上次活动会话
  if (activeTab) await selectTab(activeTab)           // 恢复窗口关闭前的工作上下文
})
</script>

<template>
  <div class="app-shell">
    <header class="titlebar">
      <mdui-button-icon class="titlebar__home" :class="{ 'is-active': ui.activeView === 'home' }" aria-label="主页" @click="openHome">
        <mdui-icon-home></mdui-icon-home>
      </mdui-button-icon>
      <div class="titlebar__tabs" role="tablist" aria-label="已打开会话">
        <button v-for="tab in tabs.tabs" :key="tab.key" class="session-tab" :class="{ 'is-active': ui.activeView === 'chat' && tabs.activeKey === tab.key }" type="button" role="tab" @click="selectTab(tab)">
          <span class="session-tab__status" :class="{ 'is-running': chat.hasConversation(tab.key) && tab.key === tabs.activeKey && chat.isRunning }"></span>
          <span class="session-tab__title">{{ tab.title || '未命名会话' }}</span>
          <mdui-button-icon class="session-tab__close" aria-label="关闭会话" @click="closeTab($event, tab)">
            <mdui-icon-close></mdui-icon-close>
          </mdui-button-icon>
        </button>
      </div>
      <mdui-button-icon class="titlebar__new" aria-label="新建会话" @click="startNewChat">
        <mdui-icon-add></mdui-icon-add>
      </mdui-button-icon>
      <div class="titlebar__spacer"></div>
      <mdui-button-icon :class="{ 'is-active': ui.activeView === 'tools' }" aria-label="工具" @click="openUtility('tools')">
        <mdui-icon-build></mdui-icon-build>
      </mdui-button-icon>
      <mdui-button-icon :class="{ 'is-active': ui.activeView === 'settings' }" aria-label="设置" @click="openUtility('settings')">
        <mdui-icon-settings></mdui-icon-settings>
      </mdui-button-icon>
    </header>

    <main class="main-area">
      <Sessions v-if="ui.activeView === 'home'" @open="openSession" @new="startNewChat" @remove="removeSession" />
      <Chat v-else-if="ui.activeView === 'chat'" />
      <Tools v-else-if="ui.activeView === 'tools'" />
      <Settings v-else />
    </main>
  </div>
</template>
