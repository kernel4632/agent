<!--
应用外壳：负责视图切换、抽屉、顶部栏和跨视图事件接线。
页面在 draft/、session/、settings/；抽屉、顶部栏、命令面板、提示条和快捷键在 app/；导航、设置、反馈等动作由 commands/ 提供。
入口：main.js 挂载本组件；调用示例：<AppDrawer :open="drawerOpen" />、<TopBar :session="session" @new="openDraft" />。
-->
<script setup>
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import DraftView from './draft/DraftView.vue'
import SessionView from './session/SessionView.vue'
import AppDrawer from './app/AppDrawer.vue'
import TopBar from './app/TopBar.vue'
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
import { normalizeAppearance } from './theme/index.js'

const SettingsPage = defineAsyncComponent(() => import('./settings/SettingsPage.vue'))
const draftView = ref(null)
const homeDraft = ref('')
const homeFiles = ref([])
const creating = ref(false)
const drawerOpen = ref(false)
const reviewOpen = ref(false)
const session = computed(() => store.ui.view === 'chat' ? activeSession.value : null)
const selectedWorkspace = computed(() => store.workspaces.find(item => item.id === store.ui.activeWorkspaceID) || store.workspaces[0])
const mode = computed(() => store.ui.settingsOpen ? 'settings' : session.value ? 'session' : 'draft')
const appearance = computed(() => normalizeAppearance(store.settings.draft?.appearance ?? store.config.appearance))

// 回到空对话：清掉草稿页的输入和附件，并收起手机抽屉。
async function goHome() {
  if (!await UI.openHome()) return false
  drawerOpen.value = false
  homeDraft.value = ''
  homeFiles.value = []
  reviewOpen.value = false
  return true
}

// 打开新对话页，并等页面渲染后把焦点交给输入框。
async function openDraft() {
  if (creating.value || !await goHome()) return
  await nextTick()
  draftView.value?.focus()
}

function openSession(id) {
  drawerOpen.value = false
  return Session.open(id)
}

async function openSettings(section) {
  drawerOpen.value = false
  return UI.openSettings(section)
}

// 打开设置后可能从命令面板或快捷键进入，统一在这里收起抽屉。
watch(() => store.ui.settingsOpen, open => { if (open) drawerOpen.value = false })

// --- 命令面板：列表和开关交给 app/usePalette，这里只把导航动作接进去 ---
const { open: paletteOpen, items: paletteItems, openPalette, closePalette, run: runPalette } = usePalette({ openDraft, openSession })

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
  openSettings,
  isSettingsOpen: () => store.ui.settingsOpen,
  closeSettings: () => UI.closeSettings(),
  session: () => session.value,
  stopSession: id => Chat.stop(id),
  newConversation: openDraft,
})

onMounted(() => window.addEventListener('keydown', shortcuts))
onUnmounted(() => window.removeEventListener('keydown', shortcuts))
</script>

<template>
  <ThemeProvider :appearance="appearance">
    <div class="rikka-app">
      <AppDrawer
        v-if="mode !== 'settings'"
        :open="drawerOpen"
        @close="drawerOpen = false"
        @open="openSession"
        @settings="openSettings()"
      />

      <div class="rikka-main">
        <TopBar
          v-if="mode !== 'settings'"
          :session="session"
          :workspace="selectedWorkspace"
          :review-open="reviewOpen"
          @menu="drawerOpen = true"
          @new="openDraft"
          @update:review-open="reviewOpen = $event"
        />

        <main class="app-main">
          <ConnectionError v-if="store.ui.errorMessage" :message="store.ui.errorMessage" />

          <SettingsPage v-if="mode === 'settings'" class="settings-panel" />

          <DraftView
            v-else-if="mode === 'draft'"
            ref="draftView"
            v-model:draft="homeDraft"
            :model="store.config.activeModel"
            :busy="creating || store.ui.isLoading || !!store.ui.errorMessage"
            :files="homeFiles"
            @submit="submitMessage"
            @attach="attachFiles"
            @remove-file="removeFile"
          />

          <SessionView
            v-else
            :session="session"
            :workspace="selectedWorkspace"
            :busy="creating || store.ui.isLoading || !!store.ui.errorMessage"
            v-model:review-open="reviewOpen"
          />
        </main>
      </div>

      <Toast v-if="store.ui.toast" :message="store.ui.toast" @close="store.ui.toast = ''" />
      <CommandPalette v-model:open="paletteOpen" :items="paletteItems" @select="runPalette" />
    </div>
  </ThemeProvider>
</template>

<style scoped lang="scss">
.rikka-app { display: flex; width: 100%; height: 100%; height: 100dvh; min-height: 0; overflow: hidden; background: var(--la-bg); }
.rikka-main { display: flex; min-width: 0; min-height: 0; flex: 1; flex-direction: column; }
.app-main { position: relative; display: flex; flex: 1; min-height: 0; flex-direction: column; overflow: hidden; }
</style>
