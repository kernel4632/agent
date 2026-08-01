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

function navigate(action) {
  action()
  if (window.innerWidth <= 760) UI.toggleSidebar(false)
}
</script>

<template>
  <div class="app-shell" :class="{ 'app-shell--open': store.ui.sidebarOpen }">
    <aside class="sidebar" :class="{ 'sidebar--open': store.ui.sidebarOpen }">
      <div class="sidebar__first">
        <mdui-button-icon class="product-logo" :aria-label="t('agentHome')" title="Agent" @click="navigate(UI.openHome)"><mdui-avatar>A</mdui-avatar></mdui-button-icon>
        <mdui-button-icon v-if="store.ui.sidebarOpen" class="icon-command" :aria-label="t('collapseSidebar')" :title="t('collapseSidebar')" @click="UI.toggleSidebar(false)">
          <mdui-icon-keyboard-double-arrow-left></mdui-icon-keyboard-double-arrow-left>
        </mdui-button-icon>
      </div>

      <nav class="sidebar__second" :aria-label="t('mainNav')">
        <mdui-button variant="text" full-width :class="{ 'is-active': store.ui.view === 'home' }" :title="t('home')" @click="navigate(UI.openHome)">
          <mdui-icon-home slot="icon"></mdui-icon-home><span v-if="store.ui.sidebarOpen">{{ t('home') }}</span>
        </mdui-button>
        <mdui-button variant="text" full-width :title="t('newChat')" @click="navigate(() => Session.create())">
          <mdui-icon-add slot="icon"></mdui-icon-add><span v-if="store.ui.sidebarOpen">{{ t('newChat') }}</span>
        </mdui-button>
      </nav>

      <section v-if="store.ui.sidebarOpen" class="sidebar__third">
        <div class="sidebar__label"><span>{{ t('sessions') }}</span><small>{{ recentSessions.length }}</small></div>
        <div class="sidebar__sessions">
          <mdui-button v-for="session in recentSessions" :key="session.id" variant="text" full-width :class="{ 'is-active': store.ui.view === 'chat' && store.ui.activeSessionID === session.id }" :title="session.title" @click="openSession(session.id)">
            <mdui-icon-history slot="icon" :class="{ 'is-running': store.sessions[session.id]?.status === 'running' }"></mdui-icon-history>{{ session.title }}
          </mdui-button>
        </div>
      </section>

      <div v-else class="sidebar__fourth">
        <mdui-button-icon class="icon-command" :aria-label="t('expandSidebar')" :title="t('expandSidebar')" @click="UI.toggleSidebar(true)">
          <mdui-icon-menu-open></mdui-icon-menu-open>
        </mdui-button-icon>
      </div>

      <div class="sidebar__fifth">
        <mdui-button variant="text" full-width :class="{ 'is-active': store.ui.view === 'settings' }" :title="t('settings')" @click="navigate(() => { UI.toggleSidebar(false); UI.openSettings() })">
          <mdui-icon-settings slot="icon"></mdui-icon-settings><span v-if="store.ui.sidebarOpen">{{ t('settings') }}</span>
        </mdui-button>
      </div>
    </aside>

    <div v-if="store.ui.sidebarOpen" class="sidebar-scrim" @click="UI.toggleSidebar(false)"></div>

    <main class="main-area">
      <Transition name="view-change" mode="out-in">
        <Sessions v-if="store.ui.view === 'home'" key="home" />
        <Chat v-else-if="store.ui.view === 'chat'" key="chat" />
        <Settings v-else key="settings" />
      </Transition>
    </main>

    <mdui-snackbar placement="bottom-end" :open="Boolean(store.ui.toast)" :message="store.ui.toast"></mdui-snackbar>
  </div>
</template>

<style lang="scss" src="./styles/App.scss"></style>
