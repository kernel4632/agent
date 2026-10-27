<!--
应用外壳：负责视图切换、抽屉、顶部栏和跨视图事件接线。
页面在 draft/、session/、settings/；抽屉、顶部栏、命令面板、提示条和快捷键在 app/；导航、设置、反馈等动作由 session/、settings/、app/ 里的指令提供。
入口：main.js 挂载本组件；调用示例：<AppDrawer :open="drawerOpen" @new="openDraft" />、<TopBar :session="session" @settings="openSettings()" />。
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
import { Session, AUTO_APPROVE_KINDS } from './session/session.js'
import { Chat } from './session/chat.js'
import { UI, activeSession } from './app/ui.js'
import { DEFAULT_SETTINGS } from './defaults.js'
import { normalizeAppearance } from './theme/index.js'
import { readAttachments } from './utils/attachments.js'

const SettingsPage = defineAsyncComponent(() => import('./settings/SettingsPage.vue'))
const draftView = ref(null)
const homeDraft = ref('')
const homeFiles = ref([])
const creating = ref(false)
const drawerOpen = ref(false)
const todoOpen = ref(false)
// 新对话页还没有会话，但智能体/权限选择要在发送前可见，发送时再写进创建出的会话。
const draftAgent = ref('build')
const draftAutoApprove = ref(Object.fromEntries(AUTO_APPROVE_KINDS.map(item => [item.kind, false])))
const draftAutoApproveLimit = ref(DEFAULT_SETTINGS.autoApproveLimit)
const draftReasoning = ref(DEFAULT_SETTINGS.reasoning)
const session = computed(() => store.ui.view === 'chat' ? activeSession.value : null)
const mode = computed(() => store.ui.settingsOpen ? 'settings' : session.value ? 'session' : 'draft')
const appearance = computed(() => normalizeAppearance(store.settings.draft?.appearance ?? store.config.appearance))

// 回到空对话：清掉草稿页的输入和附件，并收起手机抽屉。
async function goHome() {
  if (!await UI.openHome()) return false
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
  return Session.open(id)
}

async function openSettings(section) {
  drawerOpen.value = false
  return UI.openSettings(section)
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
    current = await Session.create()
    if (!current) return
    current.draft = content
    current.files = homeFiles.value
    homeDraft.value = ''
    homeFiles.value = []
    // 把新对话页选过的智能体和权限写进刚创建的会话；默认值也写，入口不比较默认值。
    await Session.saveSettings(current.id, {
      agent: draftAgent.value,
      autoApprove: { ...draftAutoApprove.value },
      autoApproveLimit: draftAutoApproveLimit.value,
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
  errors.forEach(UI.notify)                                 // 被拒绝的文件逐个说明原因
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
            <SettingsPage v-if="mode === 'settings'" key="settings" class="settings-panel" />

            <DraftView
              v-else-if="mode === 'draft'"
              key="draft"
              ref="draftView"
              v-model:draft="homeDraft"
              :model="store.config.activeModel"
              :agent="draftAgent"
              :auto-approve="draftAutoApprove"
              :auto-approve-limit="draftAutoApproveLimit"
              :reasoning="draftReasoning"
              :busy="creating || store.ui.isLoading || !!store.ui.errorMessage"
              :files="homeFiles"
              @update:agent="draftAgent = $event"
              @update:auto-approve="draftAutoApprove = $event"
              @update:auto-approve-limit="draftAutoApproveLimit = $event"
              @update:reasoning="draftReasoning = $event"
              @submit="submitMessage"
              @attach="attachFiles"
              @remove-file="removeFile"
            />

            <SessionView
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

<style scoped lang="scss">
.rikka-app { display: flex; width: 100%; height: 100%; height: 100dvh; min-height: 0; overflow: hidden; background: var(--la-bg); }
.rikka-main { display: flex; min-width: 0; min-height: 0; flex: 1; flex-direction: column; }
.app-main { position: relative; display: flex; flex: 1; min-height: 0; flex-direction: column; overflow: hidden; }
/* 页面切换像 KIMA 的注意力引导：进入时轻微上移并淡入，离开更快。 */
.view-enter-active { transition: opacity var(--la-motion-enter) var(--kima-curve-standard), transform var(--la-motion-enter) var(--kima-curve-standard); }
.view-leave-active { transition: opacity var(--la-motion-exit) var(--kima-curve-standard), transform var(--la-motion-exit) var(--kima-curve-standard); }
.view-enter-from { opacity: 0; transform: translateY(var(--la-motion-rise)); }
.view-leave-to { opacity: 0; transform: translateY(calc(var(--la-motion-rise) * -.75)); }
.alert-enter-active { transition: opacity var(--la-motion-enter) var(--kima-curve-standard), transform var(--la-motion-enter) var(--kima-curve-standard); }
.alert-leave-active { transition: opacity var(--la-motion-exit) var(--kima-curve-standard), transform var(--la-motion-exit) var(--kima-curve-standard); }
.alert-enter-from, .alert-leave-to { opacity: 0; transform: translateY(calc(var(--la-motion-rise-small) * -1)); }
@media (prefers-reduced-motion: reduce) {
  .view-enter-active, .view-leave-active, .alert-enter-active, .alert-leave-active { transition-duration: .01ms; }
}
</style>
