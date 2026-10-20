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
const session = computed(() => store.ui.view === 'chat' ? activeSession.value : null)
const draft = computed({
  get: () => session.value ? session.value.draft : homeDraft.value,
  set: value => { if (session.value) session.value.draft = value; else homeDraft.value = value },
})
const files = computed(() => session.value?.files ?? homeFiles.value)
const sidebarCollapsed = computed({ get: () => !store.ui.sidebarOpen, set: value => { store.ui.sidebarOpen = !value } })
// "更多"面板开着没有。默认收起：常用的是上面那几个开关，这里都是配一次就不动的。
const moreOpen = ref(false)
const autoApproveCount = computed(() => AUTO_APPROVE_KINDS.filter(item => session.value?.settings.autoApprove?.[item.kind]).length)

// 所有供应商下的所有模型，按"供应商/模型"给出，供按下拉框选。
const allModels = () => Object.entries(store.config.providers || {})
  .flatMap(([provider, entry]) => (entry.models || []).map(model => ({ provider, model })))

// 会话顶部模型下拉框的选项；当前模型不在配置里时也保留一条，避免选择框显示空白。
const modelOptions = computed(() => {
  const list = allModels()
  const current = session.value ? `${session.value.provider}/${session.value.model}` : ''
  if (current && !list.some(item => `${item.provider}/${item.model}` === current)) {
    list.unshift({ provider: session.value.provider, model: session.value.model })
  }
  return list
})

// --- 已有会话切换模型 ---
async function switchModel(value) {
  if (!session.value || !value) return
  const [provider, ...rest] = value.split('/')
  const model = rest.join('/')
  if (provider === session.value.provider && model === session.value.model) return
  await Session.selectModel(session.value.id, provider, model)
}

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

function toggleDrawer() { store.ui.sidebarOpen = !store.ui.sidebarOpen }
function closeDrawer() { store.ui.sidebarOpen = false }
async function openSearch() {
  store.ui.sidebarOpen = true
  await nextTick()
  sidebar.value?.focusSearch()
}
async function openSettingsFromDrawer(section) {
  closeDrawer()
  await nextTick()
  UI.openSettings(section)
}
async function selectConversation(id) {
  closeDrawer()
  await Session.open(id)
}

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
  closeDrawer()
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
    void openSearch()
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key === ',') {
    event.preventDefault()
    UI.openSettings()
    return
  }
  if (event.key === 'Escape') {
    if (store.ui.sidebarOpen) { closeDrawer(); return }
    if (session.value?.status === 'running') Chat.stop(session.value.id)
    return
  }
  if (event.key.toLowerCase() === 'n' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing && !event.target.closest('input,textarea,select,[contenteditable]')) void newConversation()
}

async function retryConnection() {
  store.ui.isLoading = true
  await Config.load()
  store.ui.isLoading = false
}

onMounted(() => {
  system.addEventListener('change', updateSystem)
  window.addEventListener('keydown', shortcuts)
})
onUnmounted(() => {
  system.removeEventListener('change', updateSystem)
  window.removeEventListener('keydown', shortcuts)
})
</script>

<template>
  <m3e-theme :scheme="scheme">
    <div class="preview-page">
      <header class="titlebar">
        <button class="icon-button titlebar__menu" :aria-label="store.ui.sidebarOpen ? '关闭导航' : '打开导航'" @click="toggleDrawer"><AppIcon :name="store.ui.sidebarOpen ? 'close' : 'menu'" :size="15" /></button>
        <span class="titlebar__mark"><AppIcon name="spark" :size="14" /></span>
        <span class="titlebar__brand">la</span>
        <span class="titlebar__sep" aria-hidden="true">|</span>
        <span class="titlebar__session" :title="session?.title || '新对话'">{{ session?.title || '新对话' }}</span>
        <span class="titlebar__meta">本地工作区</span>
        <div class="titlebar__actions">
          <button v-if="session" class="icon-button titlebar__copy" title="复制会话 ID" aria-label="复制会话 ID" @click="UI.copy(session.id)"><AppIcon name="link" :size="15" /></button>
          <button v-if="session" class="icon-button" title="创建分支" aria-label="创建分支" :disabled="session.status === 'running'" @click="Session.fork(session.id)"><AppIcon name="branch" :size="15" /></button>
          <button class="icon-button" aria-label="对话设置" title="设置" @click="UI.openSettings()"><AppIcon name="settings" :size="15" /></button>
        </div>
      </header>
      <div class="terminal__body">
        <button v-if="store.ui.sidebarOpen" class="terminal__backdrop" aria-label="关闭导航" @click="closeDrawer"></button>
        <Sidebar v-if="store.ui.sidebarOpen" ref="sidebar" v-model:collapsed="sidebarCollapsed" overlay :conversations="store.workspaces[0]?.sessions || []" :active-conversation-id="session?.id" @close="closeDrawer" @new-conversation="newConversation" @select-conversation="selectConversation" @settings="openSettingsFromDrawer" />
        <main class="app-content" :inert="store.ui.sidebarOpen">
          <header class="sessionbar">
            <div class="sessionbar__inner">
              <div class="sessionbar__title">
                <span class="sessionbar__hash" aria-hidden="true">#</span>
                <h1>{{ session?.title || '新对话' }}</h1>
                <span v-if="session" class="sessionbar__mode">{{ Session.modeLabel(session.settings.mode) }}</span>
              </div>
              <div class="sessionbar__meta">
                <select v-if="session" class="sessionbar__model" aria-label="当前会话模型" :value="`${session.provider}/${session.model}`" :disabled="session.status === 'running'" :title="session.status === 'running' ? '任务运行中，停止后才能切换模型' : '切换模型'" @change="switchModel($event.target.value)">
                  <option v-for="item in modelOptions" :key="`${item.provider}/${item.model}`" :value="`${item.provider}/${item.model}`">{{ item.provider }} / {{ item.model }}</option>
                </select>
                <span v-if="session">{{ session.messages.length }} 条消息</span>
                <span v-else>本地工作区</span>
                <span v-if="session?.contextTokens">{{ session.contextTokens.toLocaleString() }} tok</span>
                <span class="sessionbar__status"><i class="status-dot" :class="{ 'is-running': session?.status === 'running' }"></i>{{ session?.status === 'running' ? '运行中' : '就绪' }}</span>
              </div>
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
                          <div v-if="session && moreOpen" class="chat-more">
                            <section class="chat-more__group" aria-label="自动批准">
                              <h2>自动批准</h2>
                              <p>按类别跳过审批；.agentignore 仍然生效。</p>
                              <div class="chat-more__chips">
                                <button v-for="item in AUTO_APPROVE_KINDS" :key="item.kind" class="chip chip--compact" :class="{ 'chip--active': session.settings.autoApprove?.[item.kind] }" :title="`自动批准「${item.label}」：${item.hint}`" @click="Session.toggleAutoApprove(session.id, item.kind)"><AppIcon :name="item.icon" :size="12" />{{ item.label }}</button>
                              </div>
                            </section>
                            <section class="chat-more__group" aria-label="模型能力">
                              <h2>模型能力</h2>
                              <p>按模型支持情况开关。</p>
                              <div class="chat-more__chips">
                                <button class="chip chip--compact" :class="{ 'chip--active': session.settings.capabilities.image }" title="允许把图片发给模型" @click="Session.toggleCapability(session.id, 'image')"><AppIcon name="globe" :size="12" />图像</button>
                                <button class="chip chip--compact" :class="{ 'chip--active': session.settings.capabilities.cache }" title="提示词缓存，命中就是省时间和省钱" @click="Session.toggleCapability(session.id, 'cache')"><AppIcon name="copy" :size="12" />缓存</button>
                                <button class="chip chip--compact" :class="{ 'chip--active': session.settings.capabilities.stream }" title="流式输出：回复边生成边显示" @click="Session.toggleCapability(session.id, 'stream')"><AppIcon name="spark" :size="12" />流式</button>
                                <button class="chip chip--compact" :class="{ 'chip--active': session.settings.autoTitle }" title="第一次聊完让模型起个标题" @click="Session.toggleAutoTitle(session.id)"><AppIcon name="edit" :size="12" />自动标题</button>
                              </div>
                            </section>
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
                            <section class="chat-more__group" aria-label="上下文压缩">
                              <h2>自动压缩</h2>
                              <p>上下文用到这个比例时自动总结；范围 0.1 到 0.99</p>
                              <label class="chat-more__row"><span>阈值</span>
                                <input type="number" min="0.1" max="0.99" step="0.05" :value="session.settings.compactThreshold ?? 0.8" @change="Session.setCompactThreshold(session.id, Number($event.target.value))" />
                              </label>
                            </section>
                          </div>
                          <div v-if="session?.connection === 'reconnecting'" class="chat-notice" role="status">连接中断，正在重连…</div>
              <div v-if="session?.undoable" class="chat-notice"><span>对话已回退{{ session.undoable > 1 ? `（可撤销 ${session.undoable} 步，发新消息后不能再撤销）` : '' }}</span><button class="text-button" @click="Chat.undoRollback(session.id)">撤销回退</button></div>
              <ChatComposer ref="composer" v-model:draft="draft" :selected-model="session?.model || store.config.activeModel" :can-select-model="!session" :is-running="session?.status === 'running'" :busy="creating || store.ui.isLoading || !!store.ui.errorMessage" :files="files" :context-tokens="session?.contextTokens || 0" @submit="submitMessage" @stop="Chat.stop(session.id)" @attach="attachFiles" @remove-file="removeFile">
                <template #status>
                  <template v-if="session">
                    <button type="button" class="composer-mode" :class="{ 'is-active': session.settings.mode !== 'build' }" :disabled="session.status === 'running'" :title="session.status === 'running' ? '任务运行中，停止后才能切换模式' : '点击切换模式'" @click="Session.toggleMode(session.id)"><AppIcon name="eye" :size="12" />{{ Session.modeLabel(session.settings.mode) }}</button>
                    <button type="button" class="composer-mode" :class="{ 'is-active': autoApproveCount > 0 }" :aria-expanded="moreOpen" title="自动批准和模型能力" @click="moreOpen = !moreOpen"><AppIcon name="check" :size="12" />自动批准 {{ autoApproveCount }}/{{ AUTO_APPROVE_KINDS.length }}</button>
                  </template>
                </template>
              </ChatComposer>
            </div>
          </section>
        </div>
      </main>
      </div>
      <footer class="statusbar">
        <div class="statusbar__left">
          <span class="status-dot" :class="{ 'is-running': session?.status === 'running' }"></span>
          <span>{{ session?.status === 'running' ? '运行中 · esc 停止' : '就绪' }}</span>
          <span v-if="session" class="statusbar__muted">{{ session.messages.length }} 条消息</span>
        </div>
        <div class="statusbar__right">
          <span><kbd>Ctrl K</kbd> 会话</span>
          <span><kbd>N</kbd> 新对话</span>
          <span><kbd>Ctrl ,</kbd> 设置</span>
        </div>
      </footer>
      <SettingsPage v-if="store.ui.settingsOpen" />
      <div v-if="store.ui.toast && !store.ui.settingsOpen" class="app-toast" role="status">
        <AppIcon name="info" :size="17" />{{ store.ui.toast }}
        <button class="icon-button" aria-label="关闭提示" @click="store.ui.toast = ''"><AppIcon name="close" :size="14" /></button>
      </div>
    </div>
  </m3e-theme>
</template>

<style scoped lang="scss">
.preview-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100dvh;
  overflow: hidden;
  background: var(--la-bg);
}
.titlebar {
  display: flex;
  flex: 0 0 var(--la-titlebar-height);
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-bottom: 1px solid var(--la-line);
  background: var(--la-titlebar);
  color: var(--la-titlebar-text);
  user-select: none;
}
.titlebar__menu { width: 24px; height: 24px; color: var(--la-secondary); }
.titlebar__mark { display: grid; place-items: center; color: var(--la-accent); }
.titlebar__brand { color: var(--la-titlebar-text); font: 600 11px/1 var(--la-font-mono); letter-spacing: .04em; }
.titlebar__sep { color: var(--la-muted); font: 10px/1 var(--la-font-mono); }
.titlebar__session { min-width: 0; overflow: hidden; color: var(--la-text); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.titlebar__meta { max-width: 260px; margin-left: auto; overflow: hidden; color: var(--la-muted); font: 10px/1 var(--la-font-mono); text-overflow: ellipsis; white-space: nowrap; }
.titlebar__actions { display: flex; gap: 2px; margin-left: 6px; }
.titlebar__actions .icon-button { width: 24px; height: 24px; }
.terminal__body { position: relative; display: flex; flex: 1; min-height: 0; }
.terminal__backdrop { position: fixed; z-index: 60; inset: var(--la-titlebar-height) 0 var(--la-statusbar-height); padding: 0; border: 0; background: #0009; cursor: pointer; }
.app-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  background: var(--la-bg);
}
.sessionbar { flex: 0 0 42px; border-bottom: 1px solid var(--la-line); }
.sessionbar__inner { display: flex; align-items: center; justify-content: space-between; gap: 16px; height: 100%; max-width: 1000px; margin: 0 auto; padding: 0 24px; }
.sessionbar__title { display: flex; align-items: center; gap: 8px; min-width: 0; }
.sessionbar__hash { color: var(--la-accent); font: 600 14px/1 var(--la-font-mono); }
.sessionbar h1 { margin: 0; overflow: hidden; font-size: 13px; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }
.sessionbar__mode { padding: 1px 5px; border: 1px solid var(--la-line); color: var(--la-muted); font: 9px/1.6 var(--la-font-mono); text-transform: uppercase; }
.sessionbar__meta { display: flex; align-items: center; gap: 14px; color: var(--la-muted); font: 10px/1 var(--la-font-mono); white-space: nowrap; }
.sessionbar__model { max-width: 230px; overflow: hidden; border: 0; background: transparent; color: var(--la-muted); font: 10px/1 var(--la-font-mono); text-overflow: ellipsis; cursor: pointer; }
.sessionbar__model option { background: var(--la-panel); color: var(--la-text); }
.sessionbar__status { display: flex; align-items: center; gap: 6px; }
.app-view { flex: 1; min-height: 0; }
.chat-page {
  display: flex;
  height: 100%;
  flex-direction: column;
  &__scroll { flex: 1; min-height: 0; overflow: auto; }
  &__composer { flex: none; width: 100%; max-width: 1000px; margin: 0 auto; padding: 10px var(--la-chat-gutter) 12px; }
}
.chat-notice { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; padding: 5px 9px; border-left: 2px solid var(--la-accent-border); color: var(--la-secondary); font: 11px/1.7 var(--la-font-mono); }
.chip { display: inline-flex; align-items: center; gap: 5px; min-height: 22px; padding: 2px 7px; border: 1px solid var(--la-line); border-radius: var(--la-radius); background: none; color: var(--la-muted); font-size: 10px; cursor: pointer; }
.chip:hover:not(:disabled) { background: var(--la-hover); color: var(--la-text); border-color: var(--la-accent-border); }
.chip--active { background: var(--la-accent-soft); border-color: var(--la-accent-border); color: var(--la-accent); }
.chip:disabled { opacity: .45; }
.chip--compact { min-height: 20px; padding: 1px 6px; }
.chat-more { display: flex; flex-wrap: wrap; gap: 16px; max-height: 320px; margin: 0 0 8px; padding: 10px 12px; overflow-y: auto; border: 1px solid var(--la-line); border-left: 2px solid var(--la-accent-border); border-radius: 2px; background: var(--la-term-panel); }
.chat-more__group { flex: 1 1 220px; min-width: 0; }
.chat-more__group h2 { margin: 0; font-size: 11px; font-weight: 550; }
.chat-more__group p { margin: 3px 0 7px; color: var(--la-muted); font-size: 10px; line-height: 1.5; }
.chat-more__chips { display: flex; flex-wrap: wrap; gap: 4px; }
.chat-more__row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 6px; font-size: 11px; color: var(--la-secondary); }
.chat-more__row select, .chat-more__row input { flex: 0 1 150px; min-width: 0; padding: 3px 6px; border: 1px solid var(--la-line); border-radius: 2px; background: var(--la-bg); color: var(--la-text); font-size: 11px; }
.composer-mode { display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px; border: 0; border-radius: 2px; background: transparent; color: var(--la-muted); font: 10px/1.6 var(--la-font-mono); cursor: pointer; }
.composer-mode:hover:not(:disabled) { background: var(--la-hover); color: var(--la-text); }
.composer-mode.is-active { color: var(--la-accent); }
.composer-mode:disabled { opacity: .45; }
.connection-error { display: flex; align-items: center; gap: 10px; padding: 8px 24px; border-left: 2px solid var(--la-danger); color: var(--la-danger); background: #f28b820d; font: 11px/1.7 var(--la-font-mono); }
.connection-error span { flex: 1; overflow-wrap: anywhere; }
.statusbar { display: flex; flex: 0 0 var(--la-statusbar-height); align-items: center; justify-content: space-between; gap: 12px; padding: 0 12px; border-top: 1px solid var(--la-line); background: var(--la-statusbar); color: var(--la-muted); font: 10px/1 var(--la-font-mono); user-select: none; }
.statusbar__left, .statusbar__right { display: flex; align-items: center; gap: 12px; min-width: 0; }
.statusbar__right kbd { color: var(--la-secondary); font: inherit; }
.statusbar__muted { color: var(--la-muted); }
.app-toast { position: fixed; z-index: 90; bottom: calc(var(--la-statusbar-height) + 12px); left: 50%; display: flex; align-items: center; gap: 10px; max-width: calc(100vw - 32px); padding: 9px 11px; border: 1px solid var(--la-line); border-radius: 3px; background: var(--la-titlebar); color: var(--la-text); font-size: 12px; box-shadow: 0 8px 24px #0006; transform: translateX(-50%); }
@media (max-width: 760px) {
  .titlebar__meta { display: none; }
  .titlebar__copy { display: none; }
  .sessionbar__inner { padding: 0 12px; }
  .sessionbar__meta > span:not(.sessionbar__status) { display: none; }
  .sessionbar__model { max-width: 112px; font-size: 9px; }
  .sessionbar__mode { display: none; }
  .chat-page__composer { padding-bottom: max(10px, env(safe-area-inset-bottom)); }
  .statusbar__right span:nth-child(n+2) { display: none; }
}
</style>
