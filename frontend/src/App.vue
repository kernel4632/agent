<!--
应用外壳：聊天页常驻，设置作为独立整页覆盖其上；关闭后露出原来的聊天页。
views/ 组装聊天与设置，components/ 保存独立视觉区域；数据主体在 features/，编排在 commands/。
入口：main.js 挂载本组件；调用示例：<Sidebar :open="drawerOpen" @new="openDraft" />、<TopBar :session="session" @settings="openSettings()" />。
-->
<script setup>
import { Navigation } from './commands/navigation.js'
import { Notice } from "./utils/notice.js"
import { activeSession, normalizeAppearance, store } from './store.js'

import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue'
import ChatView from './views/ChatView.vue'
import Sidebar from './components/navigation/Sidebar.vue'
import TopBar from './components/navigation/TopBar.vue'
import CommandPalette from './components/navigation/CommandPalette.vue'
import Toast from './components/feedback/Toast.vue'
import RestartNotice from './components/feedback/RestartNotice.vue'
import { shortcutListener } from './utils/shortcuts.js'
import { Appearance } from "./utils/appearance.js"
import { Session } from "./features/session.js"
import { Chat } from './commands/chat.js'
import { DEFAULT_SETTINGS } from './defaults.js'
import { readAttachments } from "./utils/attachment.js"

const SettingsView = defineAsyncComponent(() => import('./views/SettingsView.vue'))
const draftView = ref(null)
const homeDraft = ref('')
const homeFiles = ref([])
const creating = ref(false)
const drawerOpen = ref(false)
const todoOpen = ref(false)
// 新对话先保留思考强度，创建后写进会话设置。
const draftReasoning = ref(DEFAULT_SETTINGS.reasoning)
const session = computed(() => store.ui.view === 'chat' ? activeSession.value : null)
const appearance = computed(() => normalizeAppearance(store.settings.draft?.appearance ?? store.config.appearance))


// 主题只在应用根挂载，所有模态层通过 html 的变量继承配色。
const system = window.matchMedia('(prefers-color-scheme: dark)')
const systemDark = ref(system.matches)
const scheme = computed(() => appearance.value.theme === 'system' ? (systemDark.value ? 'dark' : 'light') : appearance.value.theme)
const updateSystem = event => { systemDark.value = event.matches }
watchEffect(() => Appearance.apply(appearance.value, scheme.value))
onMounted(() => system.addEventListener('change', updateSystem))
onUnmounted(() => system.removeEventListener('change', updateSystem))

// 回到空对话：清掉草稿页的输入和附件，并收起手机抽屉。
async function goHome() {
  if (!await Navigation.openHome()) return false
  drawerOpen.value = false
  homeDraft.value = ''
  homeFiles.value = []
  todoOpen.value = false
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
  return Navigation.openChat(id)
}

async function openSettings(section) {
  drawerOpen.value = false
  return Navigation.openSettings(section)
}

// 打开设置后可能从命令面板或快捷键进入，统一在这里收起抽屉和任务面板。
let settingsOpener
watch(() => store.ui.settingsOpen, open => {
  if (!open) return
  settingsOpener = document.activeElement // 原页面一直在，返回时可以把焦点交还原按钮
  drawerOpen.value = false
  todoOpen.value = false
}, { flush: 'sync' })

function leaveSettingsPage(element) {
  element.inert = true
  element.setAttribute('aria-hidden', 'true')
}

function finishSettingsPage() {
  Navigation.finishSettingsClose()
  if (!store.ui.settingsOpen && settingsOpener?.isConnected) settingsOpener.focus({ preventScroll: true })
}

// --- 命令面板：入口把导航动作传给列表，开关是本地临时状态 ---
const paletteOpen = ref(false)
const paletteItems = computed(() => [
  { id: 'new', label: '新建会话', hint: 'N', run: openDraft },
  { id: 'settings', label: '设置', hint: 'Ctrl ,', run: () => openSettings() },
  ...store.sessionList.map(item => ({ id: `session:${item.id}`, label: item.title || '新会话', hint: item.cwd || '', run: () => openSession(item.id) })),
])
const openPalette = () => { paletteOpen.value = true }
const closePalette = () => { paletteOpen.value = false }
function runPalette(item) { closePalette(); void item.run() }

// 草稿页发送：先创建会话，把草稿和附件交过去，再走正常发送。
async function submitMessage(content) {
  if (creating.value || store.ui.isLoading || store.ui.errorMessage) return
  let current
  creating.value = true
  try {
    current = await Navigation.createSession()
    if (!current) return
    current.draft = content
    current.files = homeFiles.value
    homeDraft.value = ''
    homeFiles.value = []
    // 当前后端的会话设置只保存思考强度。
    await Session.saveSettings(current.id, {
      reasoning: draftReasoning.value,
    })
  } finally { creating.value = false }
  if (await Chat.send(current.id, content)) {
    if (store.sessions[current.id]?.draft === content) store.sessions[current.id].draft = ''
  }
}

// 草稿页附件先在本地收好，创建会话时一起写进新会话。
async function attachFiles(selected, options = {}) {
  const { files, errors } = await readAttachments(selected) // 大小和类型检查只在附件工具里做一次
  homeFiles.value.push(...files)                            // 通过检查的文件进入草稿附件列表
  errors.forEach(Notice.show)                                 // 被拒绝的文件逐个说明原因
  // 粘贴图片时按当前模型能力提醒一次；不影响粘贴本身。
  if (options?.pasted && files.some(file => file.kind === 'image')) {
    Chat.imagePasteNotice({ hasImage: true, provider: store.config.activeProvider, model: store.config.activeModel })
  }
}

// 只从草稿页的待发送附件里移除。
function removeFile(id) {
  homeFiles.value = homeFiles.value.filter(file => file.id !== id)
}

// --- 全局快捷键：utils/shortcuts 识别按键，这里显式传入动作 ---
const shortcuts = shortcutListener({
  paletteOpen: () => paletteOpen.value,
  openPalette,
  closePalette,
  openSettings,
  isSettingsOpen: () => store.ui.settingsOpen,
  closeSettings: () => Navigation.closeSettings(),
  session: () => session.value,
  stopSession: id => Chat.stop(id),
  newConversation: openDraft,
})

onMounted(() => window.addEventListener('keydown', shortcuts))
onUnmounted(() => window.removeEventListener('keydown', shortcuts))
</script>

<template>
  <div class="app-theme" :data-theme="scheme">
    <div class="rikka-app">
      <Sidebar
        :open="drawerOpen"
        @close="drawerOpen = false"
        @open="openSession"
        @new="openDraft"
      />

      <div class="rikka-main" :inert="store.ui.settingsOpen" :aria-hidden="store.ui.settingsOpen || undefined">
        <TopBar
          :session="session"
          :todo-open="todoOpen"
          @menu="drawerOpen = true"
          @settings="openSettings()"
          @update:todo-open="todoOpen = $event"
        />
        <RestartNotice />

        <main class="app-main">
          <ChatView
            ref="draftView"
            :session="session"
            v-model:draft="homeDraft"
            :model="store.config.activeModel"
            :reasoning="draftReasoning"
            :files="homeFiles"
            :error="store.ui.errorMessage"
            :busy="creating || store.ui.isLoading || !!store.ui.errorMessage"
            v-model:todo-open="todoOpen"
            @update:reasoning="draftReasoning = $event"
            @submit="submitMessage"
            @attach="attachFiles"
            @remove-file="removeFile"
          />
        </main>
      </div>

      <Transition name="page" @before-leave="leaveSettingsPage" @after-leave="finishSettingsPage">
        <SettingsView v-if="store.ui.settingsOpen" class="settings-panel" />
      </Transition>

      <Toast :message="store.ui.toast || ''" @close="Notice.clear()" />
      <CommandPalette v-model:open="paletteOpen" :items="paletteItems" @select="runPalette" />
    </div>
  </div>
</template>

<style scoped lang="scss" src="./styles/App.scss"></style>
