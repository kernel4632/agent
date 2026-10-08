<script setup>
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watchEffect } from 'vue'
import AppIcon from './components/AppIcon.vue'
import Sidebar from './components/Sidebar.vue'
import HomePage from './components/HomePage.vue'
import ChatComposer from './components/ChatComposer.vue'
import { store } from './store.js'
import { Session, AUTO_APPROVE_KINDS, USE_LABELS } from './commands/session.js'
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
// "更多"面板开着没有。默认收起：常用的是上面那几个开关，这里都是配一次就不动的。
const moreOpen = ref(false)

// 所有供应商下的所有模型，按"供应商/模型"给出，供按下拉框选。
const allModels = () => Object.entries(store.config.providers || {})
  .flatMap(([provider, entry]) => (entry.models || []).map(model => ({ provider, model })))

// 某一件事当前选的是哪个模型；没单独配过就是空串（＝和主模型共用）。
const useKey = (session, use) => {
  const target = session.settings.uses?.[use]
  return target ? `${target.provider}/${target.model}` : ''
}

// 把下拉框的值翻回后端认的 { provider, model }；空串表示改回共用。
const targetFrom = (session, value) => {
  if (!value) return null
  const [provider, ...rest] = value.split('/')
  return { provider, model: rest.join('/') }
}
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
                          <div v-if="session" class="chat-toolbar" role="group" aria-label="会话运行设置">
                            <button class="chip" :class="{ 'chip--active': session.settings.mode === 'plan' }" :disabled="session.status === 'running'" :title="session.status === 'running' ? '任务运行中，停止后才能切换模式' : '计划模式只保留只读工具'" @click="Session.toggleMode(session.id)"><AppIcon name="eye" :size="14" />{{ session.settings.mode === 'plan' ? '计划模式' : '执行模式' }}</button>
                            <span class="chip-label">自动批准</span>
                            <button v-for="item in AUTO_APPROVE_KINDS" :key="item.kind" class="chip chip--compact" :class="{ 'chip--active': session.settings.autoApprove?.[item.kind] }" :title="`自动批准「${item.label}」：${item.hint}（.agentignore 仍然生效）`" @click="Session.toggleAutoApprove(session.id, item.kind)"><AppIcon :name="item.icon" :size="14" />{{ item.label }}</button>
                            <span class="chat-toolbar__divider" aria-hidden="true"></span>
                            <button class="chip" :class="{ 'chip--active': session.settings.capabilities.image }" title="允许把图片发给模型" @click="Session.toggleCapability(session.id, 'image')"><AppIcon name="globe" :size="14" />图像支持</button>
                            <button class="chip" :class="{ 'chip--active': session.settings.capabilities.cache }" title="提示词缓存，命中就是省时间和省钱" @click="Session.toggleCapability(session.id, 'cache')"><AppIcon name="copy" :size="14" />提示缓存</button>
                            <button class="chip" :class="{ 'chip--active': session.settings.capabilities.stream }" title="流式输出：回复边生成边显示" @click="Session.toggleCapability(session.id, 'stream')"><AppIcon name="spark" :size="14" />流式输出</button>
                            <button class="chip" :class="{ 'chip--active': session.settings.autoTitle }" title="第一次聊完让模型起个标题；关掉就一直叫「新对话」" @click="Session.toggleAutoTitle(session.id)"><AppIcon name="edit" :size="14" />自动标题</button>
                            <button class="chip" :class="{ 'chip--active': moreOpen }" :aria-expanded="moreOpen" title="按用途分别指定模型，以及自动批准跑飞了的刹车" @click="moreOpen = !moreOpen"><AppIcon name="settings" :size="14" />更多</button>
                          </div>
                          <div v-if="session && moreOpen" class="chat-more">
                            <section class="chat-more__group" aria-label="按用途指定模型">
                              <h2>哪件事用哪个模型</h2>
                              <p>不选就和主模型（{{ session.model }}）共用</p>
                              <label v-for="(label, use) in USE_LABELS" :key="use" class="chat-more__row">
                                <span>{{ label }}</span>
                                <select :value="useKey(session, use)" @change="Session.setUse(session.id, use, targetFrom(session, $event.target.value))">
                                  <option value="">和主模型共用</option>
                                  <option v-for="item in allModels()" :key="`${item.provider}/${item.model}`" :value="`${item.provider}/${item.model}`">{{ item.provider }} / {{ item.model }}</option>
                                </select>
                              </label>
                            </section>
                            <section class="chat-more__group" aria-label="自动批准的刹车">
                              <h2>自动批准的上限</h2>
                              <p>连着自动批准这么多次就停下来问一句；填 0 表示不设上限</p>
                              <label class="chat-more__row"><span>连续次数</span>
                                <input type="number" min="0" :value="session.settings.autoApproveLimit" @change="Session.setLimit(session.id, Number($event.target.value))" />
                              </label>
                            </section>
                          </div>
                          <div v-if="session?.connection === 'reconnecting'" class="chat-notice" role="status">连接中断，正在重连…</div>
              <div v-if="session?.undoable" class="chat-notice"><span>对话已回退{{ session.undoable > 1 ? `（可撤销 ${session.undoable} 步，发新消息后不能再撤销）` : '' }}</span><button class="text-button" @click="Chat.undoRollback(session.id)">撤销回退</button></div>
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
.chat-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 12px; }
.chat-toolbar__divider { width: 1px; height: 16px; margin: 0 4px; background: var(--la-line); }
.chip { display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 4px 10px; border: 1px solid var(--la-line); border-radius: 999px; background: none; color: var(--la-muted); font-size: 11px; cursor: pointer; }
.chip:hover:not(:disabled) { background: var(--la-hover); color: var(--la-text); border-color: var(--la-accent-border); }
.chip--active { background: var(--la-accent-soft); border-color: var(--la-accent-border); color: var(--la-accent); }
.chip:disabled { opacity: .45; }
/* 四个类别排在一起，收紧一点，免得把工具栏挤成两行。 */
.chip--compact { min-height: 24px; padding: 2px 8px; }
/* "自动批准"这四个字是分组标题，不是能点的开关，所以看着要弱一些。 */
.chip-label { padding: 0 2px; color: var(--la-muted); font-size: 11px; }
/* "更多"面板：配一次就不动的东西收在这里，不占工具栏的位置。 */
.chat-more { display: flex; flex-wrap: wrap; gap: 20px; margin: -4px 0 12px; padding: 12px; border: 1px solid var(--la-line); border-radius: 10px; background: var(--la-panel); }
.chat-more__group { flex: 1 1 240px; min-width: 0; }
.chat-more__group h2 { margin: 0; font-size: 12px; font-weight: 550; }
.chat-more__group p { margin: 4px 0 8px; color: var(--la-muted); font-size: 11px; line-height: 1.5; }
.chat-more__row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 6px; font-size: 12px; color: var(--la-secondary); }
.chat-more__row select, .chat-more__row input { flex: 0 1 150px; min-width: 0; padding: 3px 6px; border: 1px solid var(--la-line); border-radius: 6px; background: var(--la-bg); color: var(--la-text); font-size: 12px; }
.connection-error { display: flex; align-items: center; gap: 10px; padding: 12px var(--la-chat-gutter); color: var(--la-danger); background: #c67a6412; font-size: 12px; }
.connection-error span { flex: 1; overflow-wrap: anywhere; }
.app-toast { position: fixed; z-index: 50; bottom: 24px; left: 50%; display: flex; align-items: center; gap: 10px; max-width: calc(100vw - 32px); padding: 10px 12px; border: 1px solid var(--la-line); border-radius: 10px; background: var(--la-panel); color: var(--la-text); font-size: 13px; box-shadow: 0 8px 24px #0004; transform: translateX(-50%); }
@media (max-width: 760px) {
  .mobile-menu { display: flex; }
  .app-header { flex-basis: 64px; padding-left: 8px; }
  .chat-page__composer { padding-bottom: max(12px, env(safe-area-inset-bottom)); }
}
</style>
