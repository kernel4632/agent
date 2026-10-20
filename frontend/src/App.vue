<!--
应用外壳：只负责视图切换、顶部标签和跨视图事件接线。
页面在 home/、draft/、session/、settings/；命令面板、提示条和快捷键在 app/；导航、设置、反馈等动作由 commands/ 提供。
入口：main.js 挂载本组件；调用示例：<Titlebar @palette="openPalette" />、<ConnectionError :message="store.ui.errorMessage" />、<CommandPalette v-model:open="paletteOpen" :items="paletteItems" @select="runPalette" />。
-->
<script setup>
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref } from 'vue'
import HomeView from './home/HomeView.vue'
import DraftView from './draft/DraftView.vue'
import SessionView from './session/SessionView.vue'
import Titlebar from './app/Titlebar.vue'
import CommandPalette from './app/CommandPalette.vue'
import ConnectionError from './app/ConnectionError.vue'
import Toast from './app/Toast.vue'
import { usePalette } from './app/usePalette.js'
import { createShortcutHandler } from './app/shortcuts.js'
import ThemeProvider from './theme/ThemeProvider.vue'
import { store } from './store.js'
import { Session } from './commands/session.js'
import { Chat } from './commands/chat.js'
import { UI, activeSession } from './commands/ui.js'
import { Tabs } from './commands/tabs.js'
import { normalizeAppearance } from './theme/index.js'

const SettingsPage = defineAsyncComponent(() => import('./settings/SettingsPage.vue'))
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

// --- 命令面板：列表和开关交给 app/usePalette，这里只把导航动作接进去 ---
const { open: paletteOpen, items: paletteItems, openPalette, closePalette, run: runPalette } = usePalette({ openDraft, goHome, openSession })

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

// --- 全局快捷键：keydown 细节在 app/shortcuts，这里只接状态读取和动作 ---
const shortcuts = createShortcutHandler({
  paletteOpen: () => paletteOpen.value,
  openPalette,
  closePalette,
  openSettings: () => UI.openSettings(),
  isSettingsOpen: () => store.ui.settingsOpen,
  closeSettings: () => UI.closeSettings(),
  session: () => session.value,
  stopSession: id => Chat.stop(id),
  newConversation: openDraft,
})

onMounted(() => {
  Tabs.restore()                                                     // 恢复上次打开的标签
  window.addEventListener('keydown', shortcuts)
})
onUnmounted(() => window.removeEventListener('keydown', shortcuts))
</script>

<template>
  <ThemeProvider :appearance="appearance">
    <div class="preview-page">
      <Titlebar :mode="mode" @home="goHome" @new="openDraft" @select="openTab" @close="closeTab" @palette="openPalette" @settings="UI.openSettings()" />

      <main class="app-main">
        <ConnectionError v-if="store.ui.errorMessage" :message="store.ui.errorMessage" />

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
</style>
