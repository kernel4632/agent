<script setup>
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watchEffect } from 'vue'
import AppIcon from './components/AppIcon.vue'
import HomeView from './home/HomeView.vue'
import DraftView from './draft/DraftView.vue'
import Composer from './composer/Composer.vue'
import SessionHeader from './session/SessionHeader.vue'
import SessionFilePanel from './session/SessionFilePanel.vue'
import Titlebar from './app/Titlebar.vue'
import CommandPalette from './app/CommandPalette.vue'
import Toast from './app/Toast.vue'
import { store } from './store.js'
import { Session, AUTO_APPROVE_KINDS, USE_LABELS } from './commands/session.js'
import { Chat } from './commands/chat.js'
import { Config } from './commands/config.js'
import { UI, activeSession } from './commands/ui.js'
import { Tabs } from './commands/tabs.js'
import { normalizeAppearance } from './theme.js'

const Timeline = defineAsyncComponent(() => import('./session/Timeline.vue'))
const SettingsPage = defineAsyncComponent(() => import('./components/settings/SettingsPage.vue'))
const draftView = ref(null)
const homeDraft = ref('')
const homeFiles = ref([])
const creating = ref(false)
const draftOpen = ref(false)
const draftKey = ref('')
const reviewOpen = ref(false)
const session = computed(() => store.ui.view === 'chat' ? activeSession.value : null)
const selectedWorkspace = computed(() => store.workspaces.find(item => item.id === store.ui.activeWorkspaceID) || store.workspaces[0])
const mode = computed(() => store.ui.settingsOpen ? 'settings' : draftOpen.value ? 'draft' : session.value ? 'session' : 'home')
const draft = computed({
  get: () => session.value ? session.value.draft : homeDraft.value,
  set: value => { if (session.value) session.value.draft = value; else homeDraft.value = value },
})
const files = computed(() => session.value?.files ?? homeFiles.value)
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

// 打开草稿页，并把草稿登记成顶部标签。
async function openDraft() {
  if (creating.value || !await UI.openHome()) return
  draftOpen.value = true
  homeDraft.value = ''
  homeFiles.value = []
  draftKey.value = Tabs.createDraft()
  await nextTick()
  draftView.value?.focus()
}

// 回到项目 / 会话总览。
async function goHome() {
  if (!await UI.openHome()) return
  draftOpen.value = false
  draftKey.value = ''
}

// 点顶部标签：草稿回到输入页，已有会话读取后打开。
async function openTab(tab) {
  Tabs.select(tab.key)
  if (!tab.sessionID) {
    draftOpen.value = true
    await UI.openHome()
    await nextTick()
    draftView.value?.focus()
    return
  }
  draftOpen.value = false
  await Session.open(tab.sessionID)
}

// 关闭标签，自动切到相邻标签；没有标签时回首页。
async function closeTab(tab) {
  const active = store.tabs.activeKey === tab.key
  const nextKey = Tabs.close(tab.key)
  if (tab.sessionID) {
    const index = store.ui.openedSessionIDs.indexOf(tab.sessionID)
    if (index >= 0) store.ui.openedSessionIDs.splice(index, 1)
  }
  if (!active) return
  const next = store.tabs.items.find(item => item.key === nextKey)
  if (next) await openTab(next)
  else await goHome()
}

async function openSession(id) {
  draftOpen.value = false
  await Session.open(id)
}

// --- 命令面板：opencode 的 Ctrl/Cmd + K ---
const paletteOpen = ref(false)
const paletteItems = computed(() => {
  const items = [
    { id: 'new', label: '新建会话', hint: 'N', run: openDraft },
    { id: 'home', label: '主页', hint: '', run: goHome },
    { id: 'settings', label: '设置', hint: 'Ctrl ,', run: () => UI.openSettings() },
  ]
  for (const workspace of store.workspaces) {
    for (const item of workspace.sessions || []) {
      items.push({ id: `session:${item.id}`, label: item.title || '新会话', hint: workspace.name, run: () => openSession(item.id) })
    }
  }
  return items
})
function openPalette() { paletteOpen.value = true }
function closePalette() { paletteOpen.value = false }
function runPalette(item) {
  closePalette()
  void item?.run?.()
}

watchEffect(() => {
  const theme = document.querySelector('m3e-theme')
  if (!theme) return
  theme.setAttribute('scheme', scheme.value)
  for (const key of ['color', 'variant', 'contrast', 'density', 'motion']) theme.setAttribute(key, String(appearance.value[key]))
  theme.toggleAttribute('strong-focus', appearance.value.strongFocus)
  theme.toggleAttribute('reduced-motion', appearance.value.reduceMotion)
  const accent = scheme.value === 'dark'
    ? `color-mix(in srgb, ${appearance.value.color} 70%, white 30%)`
    : appearance.value.color
  theme.style.setProperty('--la-accent', accent)
  theme.style.setProperty('--la-accent-soft', `color-mix(in srgb, ${accent} 10%, transparent)`)
  theme.style.setProperty('--la-accent-border', `color-mix(in srgb, ${accent} 30%, transparent)`)
}, { flush: 'post' })

async function newConversation() { await openDraft() }

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
      if (draftKey.value) {
        Tabs.promote(draftKey.value, current.id)
        Tabs.select(`session:${current.id}`)
        draftKey.value = ''
      } else {
        Tabs.openSession(current.id, current.title || '新会话')
      }
      draftOpen.value = false
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
  if (paletteOpen.value) {
    if (event.key === 'Escape') closePalette()
    return
  }
  if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'k' || event.key.toLowerCase() === 'p')) {
    event.preventDefault()
    void openPalette()
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key === ',') {
    event.preventDefault()
    UI.openSettings()
    return
  }
  if (event.key === 'Escape') {
    if (store.ui.settingsOpen) { event.preventDefault(); void UI.closeSettings(); return }
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
  Tabs.restore()
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
      <Titlebar :mode="mode" @home="goHome" @new="openDraft" @select="openTab" @close="closeTab" @palette="openPalette" @settings="UI.openSettings()" />

      <main class="app-main">
        <div v-if="store.ui.errorMessage" class="connection-error" role="alert">
          <AppIcon name="info" :size="16" /><span>无法连接后端：{{ store.ui.errorMessage }}</span><button class="text-button" @click="retryConnection">重试</button>
        </div>

        <SettingsPage v-if="mode === 'settings'" class="settings-panel" />

        <HomeView
          v-else-if="mode === 'home'"
          class="panel"
          :workspaces="store.workspaces"
          :active-workspace-id="store.ui.activeWorkspaceID"
          :active-session-id="session?.id"
          @open="openSession"
          @new="openDraft"
          @select-workspace="store.ui.activeWorkspaceID = $event"
          @settings="UI.openSettings()"
        />

        <DraftView
          v-else-if="mode === 'draft'"
          ref="draftView"
          class="panel"
          v-model:draft="draft"
          :workspace="selectedWorkspace"
          :model="store.config.activeModel"
          :busy="creating || store.ui.isLoading || !!store.ui.errorMessage"
          :files="homeFiles"
          @submit="submitMessage"
          @attach="attachFiles"
          @remove-file="removeFile"
        />

        <section v-else class="panel session-panel" aria-label="聊天">
          <SessionHeader v-model:review-open="reviewOpen" :session="session" :workspace="selectedWorkspace" :models="modelOptions" @switch-model="switchModel" />
          <div class="session-body">
            <div class="session-main">
            <div class="session-scroll">
              <Timeline :key="session.id" />
            </div>
            <div class="session-composer">
              <div v-if="!session.model" class="chat-notice"><span>此对话还未配置模型。</span><button class="text-button" @click="UI.openSettings('providers')">连接模型</button></div>
              <div v-if="moreOpen" class="chat-more">
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
              <div v-if="session.connection === 'reconnecting'" class="chat-notice" role="status">连接中断，正在重连…</div>
              <div v-if="session.undoable" class="chat-notice"><span>对话已回退{{ session.undoable > 1 ? `（可撤销 ${session.undoable} 步，发新消息后不能再撤销）` : '' }}</span><button class="text-button" @click="Chat.undoRollback(session.id)">撤销回退</button></div>
              <Composer v-model:draft="draft" :selected-model="session.model" :can-select-model="false" :is-running="session.status === 'running'" :busy="creating || store.ui.isLoading || !!store.ui.errorMessage" :files="files" :context-tokens="session.contextTokens || 0" @submit="submitMessage" @stop="Chat.stop(session.id)" @attach="attachFiles" @remove-file="removeFile">
                <template #status>
                  <button type="button" class="composer-mode" :class="{ 'is-active': session.settings.mode !== 'build' }" :disabled="session.status === 'running'" :title="session.status === 'running' ? '任务运行中，停止后才能切换模式' : '点击切换模式'" @click="Session.toggleMode(session.id)"><AppIcon name="eye" :size="12" />{{ Session.modeLabel(session.settings.mode) }}</button>
                  <button type="button" class="composer-mode" :class="{ 'is-active': autoApproveCount > 0 }" :aria-expanded="moreOpen" title="自动批准和模型能力" @click="moreOpen = !moreOpen"><AppIcon name="check" :size="12" />自动批准 {{ autoApproveCount }}/{{ AUTO_APPROVE_KINDS.length }}</button>
                </template>
              </Composer>
            </div>
            </div>
            <SessionFilePanel v-model:open="reviewOpen" :session="session" :workspace="selectedWorkspace" />
          </div>
        </section>

        <Toast v-if="store.ui.toast && !store.ui.settingsOpen" :message="store.ui.toast" @close="store.ui.toast = ''" />
      </main>

      <CommandPalette v-model:open="paletteOpen" :items="paletteItems" @select="runPalette" />
    </div>
  </m3e-theme>
</template>

<style scoped lang="scss">
.app-main { position: relative; display: flex; flex: 1; min-height: 0; flex-direction: column; }
.panel { flex: 1; min-height: 0; margin: var(--la-content-inset); border-radius: 10px; background: var(--la-panel); box-shadow: var(--la-shadow-raised); overflow: hidden; }
.connection-error { display: flex; align-items: center; gap: 8px; margin: 0 var(--la-content-inset) 8px; padding: 8px 10px; border-radius: 6px; background: color-mix(in srgb, var(--la-danger) 8%, transparent); color: var(--la-danger); font-size: 13px; }
.connection-error span { flex: 1; overflow-wrap: anywhere; }
.session-panel { display: flex; flex-direction: column; }
.session-body { display: flex; min-height: 0; flex: 1; }
.session-main { display: flex; min-width: 0; flex: 1; flex-direction: column; }
.session-scroll { min-height: 0; flex: 1; overflow: auto; }
.session-composer { width: 100%; max-width: 860px; flex: none; margin: 0 auto; padding: 8px 20px 16px; }
.chat-notice { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; padding: 6px 9px; border-radius: 6px; background: var(--la-layer-01); color: var(--la-secondary); font-size: 13px; }
.chat-more { display: flex; flex-wrap: wrap; gap: 20px; max-height: 340px; margin-bottom: 8px; padding: 16px; overflow-y: auto; border-radius: 8px; background: var(--la-layer-01); box-shadow: inset 0 0 0 .5px var(--la-line); }
.chat-more__group { flex: 1 1 240px; min-width: 0; }
.chat-more__group h2 { margin: 0; color: var(--la-text); font-size: 13px; font-weight: 530; line-height: 16px; }
.chat-more__group p { margin: 6px 0 10px; color: var(--la-muted); font-size: 13px; font-weight: 440; line-height: 20px; }
.chat-more__chips { display: flex; flex-wrap: wrap; gap: 4px; }
.chat-more__row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; color: var(--la-secondary); font-size: 13px; }
.chat-more__row select, .chat-more__row input { max-width: 150px; min-width: 0; height: 28px; padding: 0 7px; border: .5px solid var(--la-line); border-radius: 4px; background: var(--la-panel); color: var(--la-text); font-size: 12px; }
.chip { display: inline-flex; align-items: center; gap: 5px; min-height: 24px; padding: 2px 7px; border: 0; border-radius: 4px; background: var(--la-layer-02); color: var(--la-muted); font-size: 12px; cursor: pointer; }
.chip:hover:not(:disabled) { color: var(--la-text); background: var(--la-layer-03); }
.chip--active { background: var(--la-accent-soft); color: var(--la-accent); }
.chip:disabled { opacity: .5; }
.chip--compact { min-height: 22px; padding: 1px 6px; }
.composer-mode { display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px; border: 0; border-radius: 4px; background: transparent; color: var(--la-muted); font-size: 12px; font-weight: 440; cursor: pointer; }
.composer-mode:hover:not(:disabled) { background: var(--la-hover); color: var(--la-text); }
.composer-mode.is-active { color: var(--la-accent); }
.composer-mode:disabled { opacity: .5; }
@media (max-width: 767px) {
  .session-composer { padding: 6px 8px max(10px, env(safe-area-inset-bottom)); }
  .connection-error { margin-inline: 8px; }
  .chat-more { gap: 16px; padding: 12px; }
}
</style>
