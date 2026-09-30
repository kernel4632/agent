<script setup>
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watchEffect } from 'vue'
import AppIcon from './components/AppIcon.vue'
import Sidebar from './components/Sidebar.vue'
import HomePage from './components/HomePage.vue'
import ChatComposer from './components/ChatComposer.vue'
import { store } from './store.js'
import { Session } from './commands/session.js'
import { Chat } from './commands/chat.js'
import { Config } from './commands/config.js'
import { UI, activeSession } from './commands/ui.js'
import { normalizeAppearance } from './theme.js'

const ConversationFlow = defineAsyncComponent(() => import('./components/ConversationFlow.vue'))
const SettingsPage = defineAsyncComponent(() => import('./components/settings/SettingsPage.vue'))
const sidebar = ref(null)
const composer = ref(null)
const homeDraft = ref('')
const homeFiles = ref([])
const creating = ref(false)
const now = ref(Date.now())
const mobile = ref(window.innerWidth <= 760)
const session = computed(() => store.ui.view === 'chat' ? activeSession.value : null)
const draft = computed({
  get: () => session.value ? session.value.draft : homeDraft.value,
  set: value => { if (session.value) session.value.draft = value; else homeDraft.value = value },
})
const files = computed(() => session.value?.files ?? homeFiles.value)
const sidebarCollapsed = computed({ get: () => !store.ui.sidebarOpen, set: value => { store.ui.sidebarOpen = !value } })
const appearance = computed(() => normalizeAppearance(store.settings.draft?.appearance ?? store.config.appearance))
const system = window.matchMedia('(prefers-color-scheme: dark)')
const systemDark = ref(system.matches)
const scheme = computed(() => appearance.value.theme === 'system' ? systemDark.value ? 'dark' : 'light' : appearance.value.theme)
const updateSystem = event => { systemDark.value = event.matches }
const resize = () => { mobile.value = window.innerWidth <= 760 }
let clock

watchEffect(() => {
  const theme = document.querySelector('m3e-theme')
  if (!theme) return
  theme.setAttribute('scheme', scheme.value)
  for (const key of ['color', 'variant', 'contrast', 'density', 'motion']) theme.setAttribute(key, String(appearance.value[key]))
  theme.toggleAttribute('strong-focus', appearance.value.strongFocus)
  theme.toggleAttribute('reduced-motion', appearance.value.reduceMotion)
  theme.style.setProperty('--la-accent', `color-mix(in srgb, ${appearance.value.color} ${scheme.value === 'dark' ? '85%, white 15%' : '65%, #163154 35%'})`)
  theme.style.setProperty('--la-accent-soft', `color-mix(in srgb, ${appearance.value.color} 10%, transparent)`)
  theme.style.setProperty('--la-accent-border', `color-mix(in srgb, ${appearance.value.color} 30%, transparent)`)
}, { flush: 'post' })

async function newConversation() {
  if (creating.value || !await UI.openHome()) return
  homeDraft.value = ''
  homeFiles.value = []
  await nextTick()
  composer.value?.focus()
}

async function submitMessage(content) {
  if (creating.value || store.ui.isLoading || store.ui.errorMessage) return
  let current = session.value
  if (!current) {
    creating.value = true
    try {
      current = await Session.create()
      if (!current) return
      current.draft = content
      current.files = homeFiles.value
      homeDraft.value = ''
      homeFiles.value = []
    } finally { creating.value = false }
  }
  if (await Chat.send(current.id, content)) {
    if (store.sessions[current.id]?.draft === content) store.sessions[current.id].draft = ''
  }
}

async function attachFiles(selected) {
  if (session.value) return Chat.attach(session.value.id, selected)
  for (const file of selected) {
    if (file.size > 1024 * 1024) { UI.notify(`${file.name} 超过 1 MiB`); continue }
    if (!/\.(txt|md|js|jsx|ts|tsx|json|css|scss|html|vue|py|go|rs|yaml|yml|csv|xml|sh|log)$/i.test(file.name)) { UI.notify('请选择文本或代码文件'); continue }
    homeFiles.value.push({ id: crypto.randomUUID(), name: file.name, content: await file.text() })
  }
}

function removeFile(id) {
  if (session.value) Chat.removeFile(session.value.id, id)
  else homeFiles.value = homeFiles.value.filter(file => file.id !== id)
}

function shortcuts(event) {
  if (document.querySelector('dialog[open]')) return
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    sidebar.value?.focusSearch()
  }
  if (event.key === 'Escape' && mobile.value) store.ui.sidebarOpen = false
  if (event.key.toLowerCase() === 'n' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing && !event.target.closest('input,textarea,select,[contenteditable]')) void newConversation()
}

async function retryConnection() {
  store.ui.isLoading = true
  await Config.load()
  store.ui.isLoading = false
}

onMounted(() => {
  system.addEventListener('change', updateSystem)
  window.addEventListener('resize', resize)
  window.addEventListener('keydown', shortcuts)
  clock = setInterval(() => { now.value = Date.now() }, 5000)
})
onUnmounted(() => {
  system.removeEventListener('change', updateSystem)
  window.removeEventListener('resize', resize)
  window.removeEventListener('keydown', shortcuts)
  clearInterval(clock)
})
</script>

<template>
  <m3e-theme :scheme="scheme">
    <div class="preview-page">
      <Sidebar ref="sidebar" v-model:collapsed="sidebarCollapsed" :conversations="store.workspaces[0]?.sessions || []" :active-conversation-id="session?.id" @new-conversation="newConversation" />
      <main class="app-content" :inert="mobile && store.ui.sidebarOpen">
        <header class="app-header">
          <div class="app-header__location">
            <button class="icon-button mobile-menu" aria-label="打开导航" @click="UI.toggleSidebar(true)"><AppIcon name="menu" /></button>
            <div><h1>{{ session?.title || '新对话' }}</h1><p>{{ session?.model || '与 la 一起工作' }}</p></div>
          </div>
          <div class="app-header__actions">
            <button v-if="session" class="icon-button" title="复制会话 ID" aria-label="复制会话 ID" @click="UI.copy(session.id)"><AppIcon name="link" :size="17" /></button>
            <button class="icon-button" aria-label="对话设置" title="设置" @click="UI.openSettings()"><AppIcon name="settings" :size="18" /></button>
          </div>
        </header>
        <div v-if="store.ui.errorMessage" class="connection-error" role="alert">
          <AppIcon name="info" :size="18" /><span>无法连接后端：{{ store.ui.errorMessage }}</span><button class="text-button" @click="retryConnection">重试</button>
        </div>
        <div class="app-view">
          <section class="chat-page" aria-label="聊天">
            <div class="chat-page__scroll">
              <HomePage v-if="!session?.messages.length" />
              <ConversationFlow v-else :key="session.id" />
            </div>
            <div class="chat-page__composer">
              <div v-if="session && !session.model" class="chat-notice"><span>此对话还未配置模型，请连接模型后新建对话。</span><button class="text-button" @click="UI.openSettings('providers')">连接模型</button></div>
              <div v-if="session?.connection === 'reconnecting'" class="chat-notice" role="status">连接中断，正在重连…</div>
              <div v-if="session?.status === 'running' && now - session.lastEventAt > 45000" class="chat-notice" role="status">暂未收到新进度，可停止后重试。</div>
              <div v-if="session?.canRedo" class="chat-notice"><span>对话已回退</span><button class="text-button" @click="Chat.undoRollback(session.id)">撤销回退</button></div>
              <ChatComposer ref="composer" v-model:draft="draft" :selected-model="session?.model || store.config.activeModel" :can-select-model="!session" :is-running="session?.status === 'running'" :busy="creating || store.ui.isLoading || !!store.ui.errorMessage" :files="files" :context-tokens="session?.contextTokens || 0" @submit="submitMessage" @stop="Chat.stop(session.id)" @attach="attachFiles" @remove-file="removeFile" />
            </div>
          </section>
        </div>
      </main>
      <SettingsPage v-if="store.ui.settingsOpen" />
      <div v-if="store.ui.toast && !store.ui.settingsOpen" class="app-toast" role="status">
        <AppIcon name="info" :size="17" />{{ store.ui.toast }}
        <button class="icon-button" aria-label="关闭提示" @click="store.ui.toast = ''"><AppIcon name="close" :size="14" /></button>
      </div>
    </div>
  </m3e-theme>
</template>

<style scoped lang="scss">
.app-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  background: var(--la-bg);
}
.app-header {
  display: flex;
  flex: 0 0 72px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 var(--la-chat-gutter);

  &__location { display: flex; align-items: center; gap: 10px; min-width: 0; }
  &__location > div { min-width: 0; }
  h1 { margin: 0; overflow: hidden; font-size: 14px; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }
  p { margin: 5px 0 0; color: var(--la-muted); font-size: 11px; }
  &__actions { display: flex; gap: 6px; }
}
.mobile-menu { display: none; }
.app-view { flex: 1; min-height: 0; }
.chat-page {
  display: flex;
  height: 100%;
  flex-direction: column;

  &__scroll { flex: 1; min-height: 0; overflow: auto; }
  &__composer { flex: none; width: 100%; padding: 14px var(--la-chat-gutter) 22px; }
}
.chat-notice { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; color: var(--la-secondary); font-size: 12px; line-height: 1.8; }
.connection-error { display: flex; align-items: center; gap: 10px; padding: 12px var(--la-chat-gutter); color: var(--la-danger); background: #c67a6412; font-size: 12px; }
.connection-error span { flex: 1; overflow-wrap: anywhere; }
.app-toast { position: fixed; z-index: 50; bottom: 24px; left: 50%; display: flex; align-items: center; gap: 10px; max-width: calc(100vw - 32px); padding: 10px 12px; border: 1px solid var(--la-line); border-radius: 10px; background: var(--la-panel); color: var(--la-text); font-size: 13px; box-shadow: 0 8px 24px #0004; transform: translateX(-50%); }
@media (max-width: 760px) {
  .mobile-menu { display: flex; }
  .app-header { flex-basis: 64px; padding-left: 8px; }
  .chat-page__composer { padding-bottom: max(12px, env(safe-area-inset-bottom)); }
}
</style>
