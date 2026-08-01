<!--
应用壳层：严格实现五段式侧边栏，并在主页、对话页和设置页之间切换。
组件只触发 UI 与 Session 指令；全局数据变化由 Vue 自动反馈到全部入口。
调用示例：createApp(App).mount('#app')。
-->
<script setup>
import { computed, watchEffect } from 'vue'                         // 引入最近会话目录和语言副作用
import AppSidebar from './components/layout/AppSidebar.vue'          // 引入五段式应用侧边栏
import Chat from './views/Chat.vue'                                // 引入 Session 对话页
import Home from './views/Home.vue'                                 // 引入 Workspace 主页
import Settings from './views/Settings.vue'                        // 引入全局设置页
import { Session } from './commands/session.js'                    // 引入新建和打开 Session 指令
import { UI } from './commands/ui.js'                              // 引入页面和侧栏指令
import { currentLanguage, t } from './i18n.js'                     // 引入响应式界面翻译
import { store } from './store.js'                                 // 引入唯一全局数据根

const recentSessions = computed(() => store.workspaces             // 汇总侧边栏需要的全部 Session 摘要
  .flatMap((workspace) => workspace.sessions.map((session) => ({ ...session, workspaceID: workspace.id, status: store.sessions[session.id]?.status })))
  .sort((left, right) => right.updatedAt - left.updatedAt)
  )                                                                  // 侧边栏展示全部会话，滚动容器负责填满高度

watchEffect(() => { document.documentElement.lang = currentLanguage() }) // 同步辅助技术和浏览器语言


// --- 打开侧边栏 Session ---
async function openSession(sessionID) {
  await Session.open(sessionID)                                    // 等待读取 Session 并切换对话页
  if (window.innerWidth <= 760) UI.toggleSidebar(false)            // 移动端选择后释放主内容空间
}

async function navigate(action) {
  await action()                                                        // 等待创建、保存等异步业务完成后再执行后续导航
  if (window.innerWidth <= 760) UI.toggleSidebar(false)
}
</script>

<template>
  <m3e-theme color="#a0a0a0" scheme="dark" density="0" class="app-theme">
    <div class="app-shell" :class="{ 'app-shell--open': store.ui.sidebarOpen }">
      <AppSidebar :open="store.ui.sidebarOpen" :view="store.ui.view" :active-session-id="store.ui.activeSessionID" :sessions="recentSessions" @home="navigate(UI.openHome)" @create="navigate(() => Session.create())" @open-session="openSession" @collapse="UI.toggleSidebar(false)" @expand="UI.toggleSidebar(true)" @settings="navigate(() => UI.openSettings())" />
      <div v-if="store.ui.sidebarOpen" class="sidebar-scrim" @click="UI.toggleSidebar(false)"></div>
      <main class="main-area">
        <div v-if="store.ui.isLoading" class="app-status"><m3e-circular-progress-indicator variant="wavy" indeterminate aria-label="正在连接 Agent Server"></m3e-circular-progress-indicator><strong>正在连接 Agent Server</strong></div>
        <div v-else-if="store.ui.errorMessage && !store.workspaces.length" class="app-status is-error"><m3e-icon name="error"></m3e-icon><strong>Agent Server 不可用</strong><span>{{ store.ui.errorMessage }}</span></div>
        <Transition v-else name="view-change" mode="out-in"><Home v-if="store.ui.view === 'home'" key="home" /><Chat v-else-if="store.ui.view === 'chat'" key="chat" /><Settings v-else key="settings" /></Transition>
      </main>
      <m3e-snackbar v-if="store.ui.toast">{{ store.ui.toast }}</m3e-snackbar>
    </div>
  </m3e-theme>
</template>

<style lang="scss" src="./styles/App.scss"></style>
