<!--
应用壳层：组织固定侧栏、移动遮罩和四个独立业务视图。
入口 main.js 只挂载本组件；导航触发、会话指令和响应式反馈在此集中连接。
调用示例：createApp(App).mount('#app')。
-->
<script setup>
import { onBeforeUnmount, onMounted } from 'vue'      // 引入应用初始化和视口监听生命周期
import Chat from './views/Chat.vue'                   // 引入主对话工作区
import Sessions from './views/Sessions.vue'           // 引入完整会话管理区
import Settings from './views/Settings.vue'           // 引入配置管理区
import Tools from './views/Tools.vue'                 // 引入工具注册表区
import { useChatStore } from './stores/chat.js'       // 引入当前对话清理和加载动作
import { useSessionStore } from './stores/session.js' // 引入会话创建与选择动作
import { useUIStore } from './stores/ui.js'           // 引入导航和侧栏状态

const chat = useChatStore()                           // 读取当前对话上下文
const sessions = useSessionStore()                    // 读取侧栏会话摘要
const ui = useUIStore()                               // 读取当前业务视图和布局状态
const mobileViewport = window.matchMedia('(max-width: 760px)') // 建立移动断点监听器

const navigation = [                                  // 定义稳定主导航，图标由模板显式渲染
  { name: 'chat', label: '对话' },                    // 打开当前对话工作区
  { name: 'sessions', label: '会话' },                // 打开全部会话管理区
  { name: 'tools', label: '工具' },                   // 打开工具注册表
  { name: 'settings', label: '设置' },                // 打开模型与权限配置
]


// --- 响应视口修改侧栏 ---
function syncSidebar(event) {
  ui.setSidebar(!event.matches)                       // 移动端默认收起，桌面端默认展开
}


// --- 打开导航视图 ---
function openView(viewName) {
  ui.openView(viewName)                               // 修改当前主区域业务视图
  if (mobileViewport.matches) ui.setSidebar(false)    // 移动端选择后释放内容视口
}


// --- 创建空白会话 ---
function startNewChat() {
  sessions.selectedID = ''                           // 清除侧栏当前选择
  chat.loadSession(null)                             // 清除当前消息并等待发送时自动创建
  openView('chat')                                   // 反馈可立即输入的新对话页
}


// --- 从侧栏打开会话 ---
async function openSession(sessionID) {
  const session = await sessions.select(sessionID)    // 请求 Server 完整会话历史
  if (!session) return                                // 加载失败时不破坏当前聊天
  chat.loadSession(session)                           // 用持久化消息替换聊天数据
  openView('chat')                                   // 将用户带回对话工作区
}

onMounted(() => {
  syncSidebar(mobileViewport)                         // 首次按当前窗口设置侧栏
  mobileViewport.addEventListener('change', syncSidebar) // 后续跨断点时同步布局
  sessions.refresh()                                 // 应用启动即读取真实会话摘要
})

onBeforeUnmount(() => mobileViewport.removeEventListener('change', syncSidebar)) // 卸载时释放窗口监听
</script>

<template>
  <div class="app-shell" :class="{ 'app-shell--sidebar': ui.isSidebarOpen }">
    <button v-if="ui.isSidebarOpen" class="sidebar-scrim" type="button" aria-label="关闭侧栏" @click="ui.setSidebar(false)"></button>
    <aside class="sidebar" :class="{ 'sidebar--open': ui.isSidebarOpen }">
      <header class="sidebar__brand">
        <button type="button" aria-label="新对话" @click="startNewChat">A</button>
        <mdui-button-icon aria-label="收起侧栏" @click="ui.toggleSidebar">
          <mdui-icon-menu></mdui-icon-menu>
        </mdui-button-icon>
      </header>
      <button class="new-chat" type="button" @click="startNewChat">
        <mdui-icon-add></mdui-icon-add>
        <span>新对话</span>
      </button>
      <nav class="primary-nav" aria-label="主要导航">
        <button v-for="item in navigation" :key="item.name" type="button" :class="{ 'is-active': ui.activeView === item.name }" @click="openView(item.name)">
          <mdui-icon-history v-if="item.name === 'sessions'"></mdui-icon-history>
          <mdui-icon-build v-else-if="item.name === 'tools'"></mdui-icon-build>
          <mdui-icon-settings v-else-if="item.name === 'settings'"></mdui-icon-settings>
          <span v-else class="nav-agent">A</span>
          <span>{{ item.label }}</span>
        </button>
      </nav>
      <div class="sidebar__history">
        <small>最近</small>
        <button v-for="session in sessions.sessions.slice(0, 7)" :key="session.id" type="button" :class="{ 'is-active': sessions.selectedID === session.id && ui.activeView === 'chat' }" @click="openSession(session.id)">
          <span>{{ session.title || '未命名会话' }}</span>
        </button>
      </div>
    </aside>

    <main class="main-area">
      <mdui-button-icon v-if="!ui.isSidebarOpen" class="menu-trigger" aria-label="打开侧栏" @click="ui.toggleSidebar">
        <mdui-icon-menu></mdui-icon-menu>
      </mdui-button-icon>
      <Chat v-if="ui.activeView === 'chat'" />
      <Sessions v-else-if="ui.activeView === 'sessions'" />
      <Tools v-else-if="ui.activeView === 'tools'" />
      <Settings v-else />
    </main>
  </div>
</template>
