<!--
应用外壳：负责视图切换、抽屉、顶部栏和跨视图事件接线。
页面在 draft/、session/、settings/；抽屉、顶部栏、命令面板、提示条和快捷键在 app/；导航、设置、反馈等动作由 session/、settings/、app/ 里的指令提供。
入口：main.js 挂载本组件；调用示例：<Sidebar :open="drawerOpen" @new="openDraft" />、<TopBar :session="session" @settings="openSettings()" />。
-->
<script setup>
import { Navigation } from './commands/navigation.js'
import { Notice } from './commands/notice.js'
import { activeSession } from './store.js'

import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import DraftView from './views/DraftView.vue'
import ChatView from './views/ChatView.vue'
import Sidebar from './components/Sidebar.vue'
import TopBar from './components/TopBar.vue'
import CommandPalette from './components/CommandPalette.vue'
import ConnectionError from './components/ConnectionError.vue'
import Toast from './components/Toast.vue'
import { usePalette } from './components/usePalette.js'
import { shortcutListener } from './utils/shortcuts.js'
import ThemeProvider from './components/ThemeProvider.vue'
import { store } from './store.js'
import { Session } from './commands/session.js'
import { Chat } from './commands/chat.js'
import { DEFAULT_SETTINGS } from './defaults.js'
import { normalizeAppearance } from './store.js'
import { readAttachments } from './commands/attachment.js'

const SettingsView = defineAsyncComponent(() => import('./views/SettingsView.vue'))
const draftView = ref(null)
const homeDraft = ref('')
const homeFiles = ref([])
const creating = ref(false)
const drawerOpen = ref(false)
const todoOpen = ref(false)
// 新对话页还没有会话，但智能体/权限选择要在发送前可见，发送时再写进创建出的会话。
const draftAgent = ref('build')
const draftReasoning = ref(DEFAULT_SETTINGS.reasoning)
const session = computed(() => store.ui.view === 'chat' ? activeSession.value : null)
const mode = computed(() => store.ui.settingsOpen ? 'settings' : session.value ? 'session' : 'draft')
const appearance = computed(() => normalizeAppearance(store.settings.draft?.appearance ?? store.config.appearance))

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
watch(() => store.ui.settingsOpen, open => {
  if (!open) return
  drawerOpen.value = false
  todoOpen.value = false
})

// --- 命令面板：列表和开关交给 app/usePalette，这里只把导航动作接进去 ---
const { open: paletteOpen, items: paletteItems, openPalette, closePalette, run: runPalette } = usePalette({ openDraft, openSession })

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
    // 把新对话页选过的智能体和权限写进刚创建的会话；默认值也写，入口不比较默认值。
    await Session.saveSettings(current.id, {
      agent: draftAgent.value,
      reasoning: draftReasoning.value,
    })
  } finally { creating.value = false }
  if (await Chat.send(current.id, content)) {
    if (store.sessions[current.id]?.draft === content) store.sessions[current.id].draft = ''
  }
}

// 草稿页附件先在本地收好，创建会话时一起写进新会话。
async function attachFiles(selected) {
  const { files, errors } = await readAttachments(selected) // 大小和类型检查只在附件工具里做一次
  homeFiles.value.push(...files)                            // 通过检查的文件进入草稿附件列表
  errors.forEach(Notice.show)                                 // 被拒绝的文件逐个说明原因
}

// 只从草稿页的待发送附件里移除。
function removeFile(id) {
  homeFiles.value = homeFiles.value.filter(file => file.id !== id)
}

// --- 全局快捷键：keydown 细节在 app/shortcuts，这里只接状态读取和动作 ---
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
  <ThemeProvider :appearance="appearance">
    <div class="rikka-app">
      <Sidebar
        v-if="mode !== 'settings'"
        :open="drawerOpen"
        @close="drawerOpen = false"
        @open="openSession"
        @new="openDraft"
      />

      <div class="rikka-main">
        <TopBar
          v-if="mode !== 'settings'"
          :session="session"
          :todo-open="todoOpen"
          @menu="drawerOpen = true"
          @settings="openSettings()"
          @update:todo-open="todoOpen = $event"
        />

        <main class="app-main">
          <Transition name="alert">
            <ConnectionError v-if="store.ui.errorMessage" :message="store.ui.errorMessage" />
          </Transition>

          <Transition name="view" mode="out-in">
            <SettingsView v-if="mode === 'settings'" key="settings" class="settings-panel" />

            <DraftView
              v-else-if="mode === 'draft'"
              key="draft"
              ref="draftView"
              v-model:draft="homeDraft"
              :model="store.config.activeModel"
              :agent="draftAgent"
              :reasoning="draftReasoning"
              :busy="creating || store.ui.isLoading || !!store.ui.errorMessage"
              :files="homeFiles"
              @update:agent="draftAgent = $event"
              @update:reasoning="draftReasoning = $event"
              @submit="submitMessage"
              @attach="attachFiles"
              @remove-file="removeFile"
            />

            <ChatView
              v-else
              key="session"
              :session="session"
              :busy="creating || store.ui.isLoading || !!store.ui.errorMessage"
              v-model:todo-open="todoOpen"
            />
          </Transition>
        </main>
      </div>

      <Toast :message="store.ui.toast || ''" @close="store.ui.toast = ''" />
      <CommandPalette v-model:open="paletteOpen" :items="paletteItems" @select="runPalette" />
    </div>
  </ThemeProvider>
</template>

<style scoped lang="scss" src="./styles/App.scss"></style>
