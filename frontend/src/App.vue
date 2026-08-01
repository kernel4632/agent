<!--
应用壳层：严格实现五段式侧边栏，并在主页、对话页和设置页之间切换。
组件只触发 UI 与 Session 指令；全局数据变化由 Vue 自动反馈到全部入口。
调用示例：createApp(App).mount('#app')。
-->
<script setup>
import { computed, watchEffect } from 'vue'                         // 引入最近会话目录和语言副作用
import Chat from './views/Chat.vue'                                // 引入 Session 对话页
import Sessions from './views/Sessions.vue'                        // 引入 Workspace 主页
import Settings from './views/Settings.vue'                        // 引入全局设置页
import { Session } from './commands/session.js'                    // 引入新建和打开 Session 指令
import { UI } from './commands/ui.js'                              // 引入页面和侧栏指令
import { currentLanguage, t } from './i18n.js'                     // 引入响应式界面翻译
import { store } from './store.js'                                 // 引入唯一全局数据根

const recentSessions = computed(() => store.workspaces             // 汇总侧边栏需要的全部 Session 摘要
  .flatMap((workspace) => workspace.sessions.map((session) => ({ ...session, workspaceID: workspace.id })))
  .sort((left, right) => right.updatedAt - left.updatedAt)
  .slice(0, 12))                                                   // 侧边栏保持紧凑，不复制主页完整目录

watchEffect(() => { document.documentElement.lang = currentLanguage() }) // 同步辅助技术和浏览器语言


// --- 打开侧边栏 Session ---
function openSession(sessionID) {
  Session.open(sessionID)                                          // 指令同步 Workspace 归属和对话页
  if (window.innerWidth <= 760) UI.toggleSidebar(false)            // 移动端选择后释放主内容空间
}
</script>

<template>
  <div class="app-shell" :class="{ 'app-shell--open': store.ui.sidebarOpen }">
    <aside class="sidebar" :class="{ 'sidebar--open': store.ui.sidebarOpen }">
      <div class="sidebar__first">
        <button class="product-logo" type="button" :aria-label="t('agentHome')" title="Agent" @click="UI.openHome">A</button>
        <button v-if="store.ui.sidebarOpen" class="icon-command" type="button" :aria-label="t('collapseSidebar')" :title="t('collapseSidebar')" @click="UI.toggleSidebar(false)">
          <mdui-icon-keyboard-double-arrow-left></mdui-icon-keyboard-double-arrow-left>
        </button>
      </div>

      <nav class="sidebar__second" :aria-label="t('mainNav')">
        <button type="button" :class="{ 'is-active': store.ui.view === 'home' }" :title="t('home')" @click="UI.openHome">
          <mdui-icon-home></mdui-icon-home><span v-if="store.ui.sidebarOpen">{{ t('home') }}</span>
        </button>
        <button type="button" :title="t('newChat')" @click="Session.create()">
          <mdui-icon-add></mdui-icon-add><span v-if="store.ui.sidebarOpen">{{ t('newChat') }}</span>
        </button>
      </nav>

      <section v-if="store.ui.sidebarOpen" class="sidebar__third">
        <div class="sidebar__label"><span>{{ t('sessions') }}</span><small>{{ recentSessions.length }}</small></div>
        <div class="sidebar__sessions">
          <button v-for="session in recentSessions" :key="session.id" type="button" :class="{ 'is-active': store.ui.view === 'chat' && store.ui.activeSessionID === session.id }" :title="session.title" @click="openSession(session.id)">
            <span class="session-indicator" :class="{ 'is-running': store.sessions[session.id]?.status === 'running' }"></span>
            <span>{{ session.title }}</span>
          </button>
        </div>
      </section>

      <div v-else class="sidebar__fourth">
        <button class="icon-command" type="button" :aria-label="t('expandSidebar')" :title="t('expandSidebar')" @click="UI.toggleSidebar(true)">
          <mdui-icon-menu-open></mdui-icon-menu-open>
        </button>
      </div>

      <div class="sidebar__fifth">
        <button type="button" :class="{ 'is-active': store.ui.view === 'settings' }" :title="t('settings')" @click="UI.openSettings()">
          <mdui-icon-settings></mdui-icon-settings><span v-if="store.ui.sidebarOpen">{{ t('settings') }}</span>
        </button>
      </div>
    </aside>

    <button v-if="store.ui.sidebarOpen" class="sidebar-scrim" type="button" :aria-label="t('closeSidebar')" @click="UI.toggleSidebar(false)"></button>

    <main class="main-area">
      <Sessions v-if="store.ui.view === 'home'" />
      <Chat v-else-if="store.ui.view === 'chat'" />
      <Settings v-else />
    </main>

    <div v-if="store.ui.toast" class="toast" role="status">{{ store.ui.toast }}</div>
  </div>
</template>
