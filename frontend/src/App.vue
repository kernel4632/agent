<!--
应用组合层：连接 store 数据和 commands 指令，将业务状态映射为复用组件的 props 和事件。
本文件只负责触发入口角色：接收用户交互事件，调用对应指令，不做数据计算和业务判断。
调用示例：Vite 从 main.js 挂载本文件的根组件。
-->
<script setup>
import { computed, onMounted, onUnmounted, ref, watchEffect } from 'vue'  // 引入响应式计算和生命周期
import ChatComposer from './components/ChatComposer.vue'            // 引入对话输入编辑器
import ConversationFlow from './components/ConversationFlow.vue'    // 引入对话消息时间线
import HomePage from './components/HomePage.vue'                    // 引入工作区与会话主页
import Sidebar from './components/Sidebar.vue'                      // 引入导航侧边栏
import SettingsPage from './components/settings/SettingsPage.vue'   // 引入设置页面
import { Chat } from './commands/chat.js'                           // 引入消息发送指令
import { Session } from './commands/session.js'                     // 引入会话创建、打开和删除指令
import { Settings } from './commands/settings.js'                   // 引入设置快照保存指令
import { UI, openedConversations, homeWorkspaces, conversationsByWorkspace, activeSession, activeModels } from './commands/ui.js' // 引入页面导航、反馈和派生视图数据
import { Workspace } from './commands/workspace.js'                 // 引入工作区选择指令
import { store } from './store.js'                                  // 引入全局工作台数据
import { normalizeAppearance } from './theme.js'

// --- 侧边栏折叠状态：store 是唯一真相，collapsed 是反向映射 ---
const sidebarCollapsed = computed({
  get: () => !store.ui.sidebarOpen,
  set: (value) => { store.ui.sidebarOpen = !value },
})


// --- 主题跟随系统 prefers-color-scheme ---
const systemDark = ref(window.matchMedia('(prefers-color-scheme: dark)').matches)
let mediaQuery
const updateSystemScheme = (event) => { systemDark.value = event.matches }
onMounted(() => {
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  mediaQuery.addEventListener('change', updateSystemScheme)
  // Vue 对 custom element 绑定 property 而非 attribute，CSS 选择器依赖 attribute，需要手动同步
  const el = document.querySelector('m3e-theme')
  if (el) el.setAttribute('scheme', scheme.value)
})
onUnmounted(() => {
  mediaQuery?.removeEventListener('change', updateSystemScheme)
})

// scheme 响应 store 里的 theme 偏好：light / dark / system（跟随系统）
const scheme = computed(() => {
  const t = store.settings.draft?.appearance?.theme
    ?? store.config.appearance?.theme
    ?? 'system'
  if (t === 'light') return 'light'
  if (t === 'dark') return 'dark'
  return systemDark.value ? 'dark' : 'light'
})

const appearance = computed(() => normalizeAppearance(
  store.settings.draft?.appearance ?? store.config.appearance,
))

// Vue 对 custom element 的动态绑定会设置 property 而非 attribute
// m3e-theme[scheme="..."] CSS 选择器依赖 attribute，所以需要手动同步
watchEffect(() => {
  const nextScheme = scheme.value
  const el = document.querySelector('m3e-theme')
  if (!el) return
  el.setAttribute('scheme', nextScheme)
  el.setAttribute('color', appearance.value.color)
  el.setAttribute('variant', appearance.value.variant)
  el.setAttribute('contrast', appearance.value.contrast)
  el.setAttribute('density', String(appearance.value.density))
  el.setAttribute('motion', appearance.value.motion)
  el.toggleAttribute('strong-focus', appearance.value.strongFocus)
}, { flush: 'post' })


// --- 提交用户消息 ---
async function submitMessage(content) {
  if (!content.trim() || !activeSession.value) return               // 空消息或无会话时不触发发送
  await Chat.send(activeSession.value.id, content)                  // 调用对话指令完成发送和事件订阅
}
</script>

<template>
  <m3e-theme>
    <div class="preview-page">
      <Sidebar
        v-model:collapsed="sidebarCollapsed"
        :conversations="openedConversations"
        :active-conversation-id="store.ui.activeSessionID"
        :active-view="store.ui.view"
        @home="UI.openHome"
        @new-conversation="Session.create()"
        @select-conversation="Session.open($event)"
        @close-conversation="Session.closeOpened($event)"
        @settings="UI.openSettings()"
      />

      <main class="app-content">
        <Transition name="view" mode="out-in">
          <HomePage
            v-if="store.ui.view === 'home'"
            key="home"
            v-model:workspace-id="store.ui.activeWorkspaceID"
            :workspaces="homeWorkspaces"
            :conversations-by-workspace="conversationsByWorkspace"
            @add-workspace="Workspace.add"
            @select-conversation="Session.open($event.conversationId)"
            @rename-conversation="Session.rename($event.conversationId, $event.title)"
            @delete-conversation="Session.remove($event.conversationId)"
          />

          <section v-else-if="store.ui.view === 'chat'" key="chat" class="chat-page">
            <div class="chat-page__scroll">
              <ConversationFlow />
            </div>
            <div class="chat-page__composer">
              <ChatComposer v-model:draft="activeSession.draft" :models="activeModels" :selected-model="activeSession?.model || activeModels[0]" @submit="submitMessage" @select-model="Session.selectModel(activeSession?.id, store.config.activeProvider, $event)" />
            </div>
          </section>

          <SettingsPage v-else key="settings" @save="Settings.replaceDraftAndSave" />
        </Transition>
      </main>
    </div>
  </m3e-theme>
</template>

<style scoped lang="scss">

/* --- 主内容区自适应填充 --- */
.app-content { min-width: 0; height: 100%; overflow: hidden; flex: 1 1 auto; position: relative; }

/* --- 对话页：flex 布局，内容滚动，composer 固定底部 --- */
.chat-page { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.chat-page__scroll { flex: 1 1 0; overflow-y: auto; overflow-x: hidden; @include scrollbar-dark; }
.chat-page__composer { flex: 0 0 auto; padding: 12px 24px 20px; max-width: 820px; width: 100%; margin: 0 auto; }
</style>

<style lang="scss">
/* --- 页面切换过渡：缩放 + 淡入淡出 + 弹簧回弹（非 scoped，直接匹配 Transition 子元素）--- */
.view-enter-active {
  transition: opacity 280ms ease, transform 400ms var(--motion-spring-bouncy);
}

.view-leave-active {
  transition: opacity 150ms ease, transform 150ms ease;
}

.view-enter-from {
  opacity: 0;
  transform: scale(.97) translateY(6px);             /* 新页面从略小略下位置弹入 */
}

.view-leave-to {
  opacity: 0;
  transform: scale(.98) translateY(-4px);            /* 旧页面向略上缩小消失 */
}
</style>
