<script setup>
import { computed, defineAsyncComponent, h, nextTick, onMounted, onUnmounted, ref, watchEffect } from 'vue'
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

const loadingView = { render: () => h('div', { class: 'view-loading', role: 'status' }, '正在准备工作台…') }
const ConversationFlow = defineAsyncComponent({ loader: () => import('./components/ConversationFlow.vue'), loadingComponent: loadingView, delay: 150 })
const SettingsPage = defineAsyncComponent({ loader: () => import('./components/settings/SettingsPage.vue'), loadingComponent: loadingView, delay: 150 })

const sidebarCollapsed = computed({ get: () => !store.ui.sidebarOpen, set: value => { store.ui.sidebarOpen = !value } })
const conversations = computed(() => store.workspaces[0]?.sessions || [])
const appearance = computed(() => normalizeAppearance(store.settings.draft?.appearance ?? store.config.appearance))
const system = window.matchMedia('(prefers-color-scheme: dark)')
const systemDark = ref(system.matches)
const scheme = computed(() => appearance.value.theme === 'system' ? systemDark.value ? 'dark' : 'light' : appearance.value.theme)
const now = ref(Date.now())
const mobile = ref(window.innerWidth <= 760)
const creating = ref(false)
let clock
const updateSystem = event => { systemDark.value = event.matches }
const resize = () => { mobile.value = window.innerWidth <= 760 }

watchEffect(() => {
  const theme = document.querySelector('m3e-theme')
  if (!theme) return
  theme.setAttribute('scheme', scheme.value)
  for (const key of ['color', 'variant', 'contrast', 'density', 'motion']) theme.setAttribute(key, String(appearance.value[key]))
  theme.toggleAttribute('strong-focus', appearance.value.strongFocus)
  theme.toggleAttribute('reduced-motion', appearance.value.reduceMotion)
  theme.style.setProperty('--la-accent', `color-mix(in srgb, ${appearance.value.color} ${scheme.value === 'dark' ? '85%, white 15%' : '65%, #163154 35%'})`)
  theme.style.setProperty('--la-accent-soft', `color-mix(in srgb, ${appearance.value.color} 9%, transparent)`)
  theme.style.setProperty('--la-accent-border', `color-mix(in srgb, ${appearance.value.color} 24%, transparent)`)
}, { flush: 'post' })

async function newConversation(prompt = '') {
  if (creating.value || store.ui.isLoading) return
  creating.value = true
  try {
    const session = await Session.create()
    if (session && typeof prompt === 'string') store.sessions[session.id].draft = prompt
  } finally { creating.value = false }
}

async function submitMessage(content) {
  const session = activeSession.value
  if (!session) return
  if (await Chat.send(session.id, content)) {
    const latest = store.sessions[session.id]
    if (latest?.draft === content) latest.draft = ''
  }
}

async function focusSearch() {
  await UI.openHome()
  store.ui.sidebarOpen = !mobile.value
  await nextTick()
  document.getElementById('home-search')?.focus()
}

function shortcuts(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); void focusSearch() }
  if (event.key === 'Escape' && mobile.value) store.ui.sidebarOpen = false
  if (event.key.toLowerCase() === 'n' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing && !event.target.closest('input,textarea,select,[contenteditable],dialog')) void newConversation()
}

async function retryConnection() {
  store.ui.errorMessage = ''
  store.ui.isLoading = true
  await Config.load()
  store.ui.isLoading = false
}

onMounted(() => {
  document.querySelector('m3e-theme')?.setAttribute('scheme', scheme.value)
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
  <m3e-theme scheme="dark">
    <div class="preview-page">
      <Sidebar v-model:collapsed="sidebarCollapsed" :conversations="conversations" :active-conversation-id="store.ui.activeSessionID" :active-view="store.ui.view" @home="UI.openHome" @search="focusSearch" @new-conversation="newConversation()" @select-conversation="Session.open" @settings="UI.openSettings" />
      <main class="app-content" :inert="mobile && store.ui.sidebarOpen">
        <div class="app-ambient" aria-hidden="true"></div>
        <header class="app-header">
          <div class="app-header__location"><button class="icon-button mobile-menu" aria-label="打开导航" @click="UI.toggleSidebar(true)"><AppIcon name="menu" /></button><AppIcon class="app-header__icon" :name="store.ui.view === 'chat' ? 'chat' : store.ui.view === 'settings' ? 'settings' : 'home'" :size="16" /><span class="app-header__root">工作台</span><span class="app-header__separator">/</span><h1 class="app-header__title">{{ store.ui.view === 'chat' ? activeSession?.title || '新对话' : store.ui.view === 'settings' ? '设置与偏好' : '概览' }}</h1></div>
          <div class="app-header__actions"><button v-if="activeSession && store.ui.view === 'chat'" class="icon-button" title="复制会话 ID，可在其他浏览器中打开" aria-label="复制会话 ID" @click="UI.copy(activeSession.id)"><AppIcon name="link" :size="17" /></button><span class="connection-badge" :class="{ 'is-offline': store.ui.errorMessage }"><span class="status-dot"></span>{{ store.ui.isLoading ? '连接中' : store.ui.errorMessage ? '未连接' : '本地服务' }}</span></div>
        </header>

        <div v-if="store.ui.errorMessage" class="connection-error" role="alert"><AppIcon name="info" :size="18" /><span>无法连接后端：{{ store.ui.errorMessage }}</span><button class="text-button" @click="retryConnection">重试</button></div>

        <div class="app-view">
          <Transition name="view" mode="out-in">
            <HomePage v-if="store.ui.view === 'home'" key="home" @start="newConversation" />
            <section v-else-if="store.ui.view === 'chat' && activeSession" key="chat" class="chat-page" aria-label="聊天">
              <div class="chat-page__scroll">
                <div v-if="!activeSession.messages.length" class="chat-welcome"><span class="chat-welcome__mark"><AppIcon name="spark" :size="28" /></span><span class="eyebrow">YOUR THOUGHTS, TAKING SHAPE</span><h2>你好，今天想一起做些什么？</h2><p>一个问题、一段代码，或一个还没成形的想法。<br />从这里开始，我们一起往前走。</p><div class="chat-welcome__suggestions"><button @click="activeSession.draft = '请帮我梳理一下这个想法，并制定一个可执行的计划。'"><AppIcon name="spark" :size="15" />梳理一个想法</button><button @click="activeSession.draft = '请帮我审查接下来提供的代码，找出潜在问题。'"><AppIcon name="code" :size="15" />看看这段代码</button></div></div>
                <ConversationFlow v-else />
              </div>
              <div class="chat-page__composer">
                <div v-if="!activeSession.model" class="chat-notice"><AppIcon name="info" :size="16" /><span>先在设置中连接模型，再从首页新建对话。现有后端不支持会话内切换模型。</span><button class="text-button" @click="UI.openSettings">去设置</button></div>
                <div v-if="activeSession.connection === 'reconnecting'" class="chat-notice" role="status">实时连接中断，正在重新读取会话并连接…</div>
                <div v-if="activeSession.status === 'running' && now - activeSession.lastEventAt > 45000" class="chat-notice" role="status">暂未收到新的进度。后端未提供完整的运行错误回传；可停止后重试。</div>
                <div v-if="activeSession.canRedo" class="chat-notice"><span>对话已回退</span><button class="text-button" @click="Chat.undoRollback(activeSession.id)">撤销回退</button></div>
                <ChatComposer v-model:draft="activeSession.draft" :selected-model="activeSession.model" :is-running="activeSession.status === 'running'" :files="activeSession.files" :context-tokens="activeSession.contextTokens" @submit="submitMessage" @stop="Chat.stop(activeSession.id)" @attach="Chat.attach(activeSession.id, $event)" @remove-file="Chat.removeFile(activeSession.id, $event)" />
              </div>
            </section>
            <SettingsPage v-else key="settings" />
          </Transition>
        </div>
      </main>
      <Transition name="view"><div v-if="store.ui.toast" class="app-toast" role="status"><AppIcon name="info" :size="17" />{{ store.ui.toast }}<button class="icon-button" aria-label="关闭提示" @click="store.ui.toast = ''"><AppIcon name="close" :size="14" /></button></div></Transition>
    </div>
  </m3e-theme>
</template>

<style scoped lang="scss">
.app-content { min-width: 0; height: 100%; overflow: clip; flex: 1; position: relative; display: flex; flex-direction: column; isolation: isolate; }
.app-ambient { position: absolute; inset: 0; z-index: -1; pointer-events: none; overflow: hidden; background: radial-gradient(ellipse at 53% -18%, #75a3d119, transparent 60%), radial-gradient(ellipse at 105% 70%, #27438416, transparent 55%); }
.app-ambient::after { content: ''; position: absolute; top: -30%; right: -12%; width: 70%; height: 90%; border: 1px solid #aac6ff04; border-radius: 45%; transform: rotate(-34deg); background: linear-gradient(125deg,transparent 45%,#4a68aa05 50%, transparent 70%); }
.app-header { height: 66px; flex: 0 0 66px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 0 32px; border-bottom: 1px solid var(--la-line); }
.app-header__location { min-width: 0; display: flex; align-items: center; gap: 12px; }
.app-header__icon { color: var(--la-muted); flex-shrink: 0; }
.app-header__root, .app-header__separator { color: var(--la-muted); font-size: 11px; white-space: nowrap; }
.app-header__separator { opacity: .4; }
.app-header__title { font-size: 12px; color: var(--la-secondary); font-weight: 400; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; margin: 0; }
.app-header__actions { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.connection-badge { display: inline-flex; align-items: center; gap: 7px; font-size: 10px; color: var(--la-muted); white-space: nowrap; }
.connection-badge.is-offline .status-dot { background: #dfa891; }
.mobile-menu { display: none; }
.app-view { flex: 1; min-height: 0; position: relative; overflow: hidden; }
.chat-page { display: flex; flex-direction: column; height: 100%; }
.chat-page__scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; }
.chat-page__composer { flex: 0 0 auto; padding: 14px 28px 22px; max-width: 900px; width: 100%; margin: 0 auto; }
.chat-welcome { min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 38px 24px 48px; text-align: center; }
.chat-welcome__mark { display: grid; place-items: center; width: 62px; height: 62px; border: 1px solid #92b8fa24; background: radial-gradient(circle at 30% 0%,#8db8f42b,#0d1b351a); border-radius: 19px; color: var(--la-accent); box-shadow: 0 0 60px #6596e318; margin-bottom: 27px; }
.chat-welcome .eyebrow { font-size: 9px; }
.chat-welcome h2 { font-size: clamp(22px,2.3vw,30px); font-weight: 500; margin: 14px 0 16px; }
.chat-welcome p { color: var(--la-muted); font-size: 12px; line-height: 2; margin: 0; }
.chat-welcome__suggestions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 30px; }
.chat-welcome__suggestions button { display: flex; align-items: center; gap: 8px; color: var(--la-secondary); background: var(--la-hover); border: 1px solid var(--la-line); border-radius: 9px; padding: 10px 14px; cursor: pointer; font-size: 11px; }
.chat-welcome__suggestions button:hover { border-color: var(--la-accent-border); color: var(--la-accent); }
.chat-notice { display: flex; align-items: center; gap: 9px; font-size: 11px; color: var(--la-secondary); padding: 12px 4px; line-height: 1.8; }
.chat-notice > span { flex: 1; }
.chat-notice > svg { flex-shrink: 0; }
.chat-notice .text-button { flex-shrink: 0; }
.connection-error { display: flex; align-items: center; gap: 10px; padding: 11px 30px; background: #bf785913; color: var(--la-danger); font-size: 12px; }
.connection-error > span { flex: 1; overflow-wrap: anywhere; }
.connection-error > svg { flex-shrink: 0; }
.app-toast { position: fixed; z-index: 100; left: 50%; bottom: 28px; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; max-width: calc(100vw - 32px); padding: 9px 10px 9px 16px; border: 1px solid var(--la-accent-border); border-radius: 12px; background: var(--la-panel); box-shadow: 0 10px 40px #0004; color: var(--la-text); font-size: 12px; }
.app-toast > svg { flex-shrink: 0; color: var(--la-accent); }
@media (max-width: 760px) { .app-header { height: 58px; flex-basis: 58px; padding: 0 14px 0 8px; gap: 10px; } .mobile-menu { display: flex; } .app-header__location { gap: 7px; } .app-header__root, .app-header__separator, .app-header__icon { display: none; } .app-header__actions { gap: 4px; } .chat-page__composer { padding: 10px 14px 16px; } .chat-welcome { padding: 32px 20px; } .chat-welcome h2 { font-size: 21px; } .app-toast { bottom: 20px; width: max-content; } .connection-error { padding: 12px 16px; } }
</style>
