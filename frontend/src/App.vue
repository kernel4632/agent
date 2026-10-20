<script setup>
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref } from 'vue'
import AppIcon from './components/AppIcon.vue'
import HomeView from './home/HomeView.vue'
import DraftView from './draft/DraftView.vue'
import SessionView from './session/SessionView.vue'
import Titlebar from './app/Titlebar.vue'
import CommandPalette from './app/CommandPalette.vue'
import Toast from './app/Toast.vue'
import ThemeProvider from './theme/ThemeProvider.vue'
import { store } from './store.js'
import { Session } from './commands/session.js'
import { Chat } from './commands/chat.js'
import { Config } from './commands/config.js'
import { UI, activeSession } from './commands/ui.js'
import { Tabs } from './commands/tabs.js'
import { normalizeAppearance } from './theme/index.js'

const SettingsPage = defineAsyncComponent(() => import('./components/settings/SettingsPage.vue'))
const draftView = ref(null)
const homeDraft = ref('')
const homeFiles = ref([])
const creating = ref(false)
const draftOpen = ref(false)
const draftKey = ref('')
const session = computed(() => store.ui.view === 'chat' ? activeSession.value : null)
const selectedWorkspace = computed(() => store.workspaces.find(item => item.id === store.ui.activeWorkspaceID) || store.workspaces[0])
const mode = computed(() => store.ui.settingsOpen ? 'settings' : draftOpen.value ? 'draft' : session.value ? 'session' : 'home')
const appearance = computed(() => normalizeAppearance(store.settings.draft?.appearance ?? store.config.appearance))

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

async function newConversation() { await openDraft() }

// 草稿页发送：先创建会话，把草稿和附件交过去，再走正常发送。
async function submitMessage(content) {
  if (creating.value || store.ui.isLoading || store.ui.errorMessage) return
  let current
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
  if (await Chat.send(current.id, content)) {
    if (store.sessions[current.id]?.draft === content) store.sessions[current.id].draft = ''
  }
}

// 草稿页附件先在本地收好，创建会话时一起写进新会话。
async function attachFiles(selected) {
  for (const file of selected) {
    if (file.size > 1024 * 1024) { UI.notify(`${file.name} 超过 1 MiB`); continue }
    if (!/\.(txt|md|js|jsx|ts|tsx|json|css|scss|html|vue|py|go|rs|yaml|yml|csv|xml|sh|log)$/i.test(file.name)) { UI.notify('请选择文本或代码文件'); continue }
    homeFiles.value.push({ id: crypto.randomUUID(), name: file.name, content: await file.text() })
  }
}

// 只从草稿页的待发送附件里移除。
function removeFile(id) {
  homeFiles.value = homeFiles.value.filter(file => file.id !== id)
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
  window.addEventListener('keydown', shortcuts)
})
onUnmounted(() => {
  window.removeEventListener('keydown', shortcuts)
})
</script>

<template>
  <ThemeProvider :appearance="appearance">
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
          v-model:draft="homeDraft"
          :workspace="selectedWorkspace"
          :model="store.config.activeModel"
          :busy="creating || store.ui.isLoading || !!store.ui.errorMessage"
          :files="homeFiles"
          @submit="submitMessage"
          @attach="attachFiles"
          @remove-file="removeFile"
        />

        <SessionView v-else :session="session" :workspace="selectedWorkspace" :busy="creating || store.ui.isLoading || !!store.ui.errorMessage" />

        <Toast v-if="store.ui.toast && !store.ui.settingsOpen" :message="store.ui.toast" @close="store.ui.toast = ''" />
      </main>

      <CommandPalette v-model:open="paletteOpen" :items="paletteItems" @select="runPalette" />
    </div>
  </ThemeProvider>
</template>

<style scoped lang="scss">
.app-main { position: relative; display: flex; flex: 1; min-height: 0; flex-direction: column; }
.panel { flex: 1; min-height: 0; margin: var(--la-content-inset); border-radius: var(--la-radius-panel); background: var(--la-panel); box-shadow: var(--la-shadow-raised); overflow: hidden; }
.connection-error { display: flex; align-items: center; gap: 8px; margin: 0 var(--la-content-inset) 8px; padding: 8px 10px; border-radius: 6px; background: color-mix(in srgb, var(--la-danger) 8%, transparent); color: var(--la-danger); font-size: 13px; }
.connection-error span { flex: 1; overflow-wrap: anywhere; }
@media (max-width: 767px) {
  .connection-error { margin-inline: 8px; }
}
</style>
