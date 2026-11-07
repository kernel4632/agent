<!--
会话输入区：消息输入、附件、模型与推理强度入口、发送和停止。
会话页和新建会话页共用；只通过 v-model:draft 和事件与外面交互。
模型和推理强度合并在一个按钮里，点开是二层小窗，见 ComposerMenu；附件标签跟随同一份编辑状态。
调用示例：
<Composer
  ref="composer"
  v-model:draft="draft"
  :selected-model="model"
  :is-running="false"
  :busy="false"
  :files="files"
  @submit="submitMessage"
  @stop="stop"
  @attach="attachFiles"
  @remove-file="removeFile"
/>
-->
<script setup>
import { Navigation } from '../../commands/navigation.js'

import { computed, nextTick, ref } from 'vue'
import Icon from '../../ui/Icon.vue'
import Button from '../../ui/Button.vue'
import Chip from '../../ui/Chip.vue'
import Dialog from '../../ui/Dialog.vue'
import PathInput from '../../ui/PathInput.vue'
import { store } from '../../store.js'
import { Session } from "../../features/session.js"
import { Notice } from "../../utils/notice.js"
import ComposerMenu from './ComposerMenu.vue'
import { ATTACHMENT_ACCEPT, ATTACHMENT_PATTERN } from "../../utils/attachment.js"

const props = defineProps({
  selectedModel: { type: String, default: '' },
  selectedProvider: { type: String, default: '' },
  reasoning: { type: String, default: 'auto' },
  sessionId: { type: String, default: '' },
  isRunning: Boolean,
  canContinue: Boolean,
  busy: Boolean,
  blocked: Boolean,
  files: { type: Array, default: () => [] },
})
const draft = defineModel('draft', { type: String, default: '' })
const emit = defineEmits(['submit', 'stop', 'continue', 'attach', 'remove-file', 'update:reasoning'])
const fileInput = ref(null)
const editor = ref(null)
const currentProvider = computed(() => props.selectedProvider || store.config.activeProvider)
const addOpen = ref(false)
const expanded = ref(false)
const workspaceOpen = ref(false)
const workspacePath = ref('')
const workspaceError = ref('')
const workspaceBusy = ref(false)
const RECENT_KEY = 'agent.recent-workspaces'
const recentWorkspaces = ref(loadRecent())
const currentWorkspace = computed(() => store.sessions[props.sessionId]?.cwd || '')

function loadRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(list) ? list.filter(item => typeof item === 'string' && item.trim()).slice(0, 8) : []
  } catch {
    return []
  }
}

function rememberWorkspace(path) {
  const clean = path.trim()
  if (!clean) return
  recentWorkspaces.value = [clean, ...recentWorkspaces.value.filter(item => item.toLowerCase() !== clean.toLowerCase())].slice(0, 8)
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(recentWorkspaces.value)) } catch {}
}

function openWorkspace() {
  if (!props.sessionId || props.isRunning) return
  addOpen.value = false
  workspacePath.value = currentWorkspace.value
  workspaceError.value = ''
  workspaceOpen.value = true
}

async function switchWorkspace() {
  const path = workspacePath.value.trim()
  if (!props.sessionId) return
  if (!path) {
    workspaceError.value = '请输入目录路径'
    return
  }
  if (props.isRunning) {
    workspaceError.value = '任务运行中不能切换工作区'
    return
  }
  workspaceBusy.value = true
  workspaceError.value = ''
  try {
    const result = await Session.setCwd(props.sessionId, path)
    workspacePath.value = result.cwd
    rememberWorkspace(result.cwd)
    workspaceOpen.value = false
    Notice.show(`已切换到 ${result.cwd}`)
    nextTick(() => editor.value?.focus())
  } catch (error) {
    workspaceError.value = error.message
  } finally {
    workspaceBusy.value = false
  }
}

function toggleExpanded() {
  expanded.value = !expanded.value
  nextTick(() => editor.value?.focus())
}

async function chooseModel(provider, model) {
  if (props.sessionId) await Session.selectModel(props.sessionId, provider, model)
  else {
    store.config.activeProvider = provider
    store.config.activeModel = model
  }
  nextTick(() => editor.value?.focus())
}

function submit() {
  if (draft.value.trim() && props.selectedModel && !props.isRunning && !props.busy) emit('submit', draft.value)
}
function keydown(event) {
  if (event.key === 'Escape' && expanded.value) {
    event.preventDefault()
    expanded.value = false
    return
  }
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); submit() }
}
function addFiles(event) { emit('attach', [...event.target.files]); event.target.value = '' }

// --- 粘贴：图片转成 File 走统一附件检查，文本仍走浏览器默认 ---
// 剪贴板里的截图没有文件名，起个带时间戳的名字，扩展名按真实类型写。
const IMAGE_EXTENSION = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' }
async function paste(event) {
    const images = [...event.clipboardData.items]
        .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
        .map(item => item.getAsFile())
        .filter(Boolean)
    if (!images.length) return
    event.preventDefault()
    const files = images.map((blob, index) => {
        const extension = IMAGE_EXTENSION[blob.type] || '.png'
        const name = blob.name && ATTACHMENT_PATTERN.test(blob.name) ? blob.name : `粘贴的图片 ${new Date().toLocaleTimeString()}${extension}`
        return new File([blob], name, { type: blob.type })
    })
    emit('attach', files, { pasted: true })
}
defineExpose({ focus: () => editor.value?.focus() })
</script>

<template>
  <form class="chat-composer" :class="{ 'is-expanded': expanded }" :inert="blocked ? '' : undefined" :aria-hidden="blocked ? 'true' : undefined" aria-label="对话编辑器" @submit.prevent="submit">
    <Transition name="attachments">
      <div v-if="files.length" class="chat-composer__files">
        <template v-for="file in files" :key="file.id">
          <span v-if="file.kind === 'image'" class="chat-composer__image" :title="file.name">
            <img :src="file.dataUrl" alt="" class="chat-composer__image-thumb" />
            <button type="button" class="chat-composer__image-remove" :aria-label="`移除 ${file.name}`" @click="emit('remove-file', file.id)"><Icon name="close" :size="12" /></button>
          </span>
          <Chip v-else class="chat-composer__file" closable :label="file.name" @close="emit('remove-file', file.id)">
            <Icon name="document" :size="16" />{{ file.name }}
          </Chip>
        </template>
      </div>
    </Transition>
    <!-- 消息编辑器直接使用原生输入，焦点和输入法组合状态由此处处理。 -->
    <div class="chat-composer__editor-wrap">
      <textarea ref="editor" v-model="draft" class="chat-composer__editor" aria-label="消息" placeholder="输入消息与 AI 聊天" rows="2" @keydown="keydown" @paste="paste"></textarea>
    </div>
    <div class="chat-composer__expand-corner">
      <span class="chat-composer__expand-line" aria-hidden="true"></span>
      <button
        type="button"
        class="chat-composer__expand-button"
        :aria-label="expanded ? '退出全屏输入' : '全屏输入'"
        :aria-pressed="expanded"
        :title="expanded ? '退出全屏输入' : '全屏输入'"
        @mousedown.prevent
        @click="toggleExpanded"
      >
        <Icon :name="expanded ? 'collapse' : 'fullscreen'" :size="12" />
      </button>
    </div>
    <div class="chat-composer__bottom">
      <div class="chat-composer__options">
        <ComposerMenu
          :providers="store.config.providers" :model="selectedModel" :provider="currentProvider" :reasoning="reasoning"
          @choose-model="chooseModel" @update:reasoning="emit('update:reasoning', $event)"
          @configure="Navigation.openSettings('providers')"
        />
      </div>
      <div class="chat-composer__right">
        <button type="button" class="composer-action" aria-label="更多选项" title="更多选项" :disabled="busy" @click="addOpen = true"><Icon name="plus" :size="18" /></button>
        <Transition name="send" mode="out-in">
          <Button v-if="isRunning" key="stop" variant="plain" class="chat-composer__send is-stop" type="button" aria-label="停止生成" @click="emit('stop')"><Icon name="stop" :size="18" /></Button>
          <Button v-else-if="canContinue && !draft.trim()" key="continue" variant="plain" class="chat-composer__send is-continue" type="button" aria-label="继续助手" title="继续助手" :disabled="busy || !selectedModel" @click="emit('continue')"><Icon name="play" :size="18" /></Button>
          <Button v-else key="send" variant="plain" class="chat-composer__send" type="submit" aria-label="发送消息" :disabled="busy || !draft.trim() || !selectedModel"><Icon name="up" :size="18" /></Button>
        </Transition>
      </div>
    </div>
    <!-- 隐藏的 file input 是编辑器专用控件：由更多选项里的附件按钮触发，保留原生实现。 -->
    <input ref="fileInput" class="sr-only" type="file" multiple :accept="ATTACHMENT_ACCEPT" tabindex="-1" aria-label="选择文本附件" @change="addFiles" />
  </form>

  <Dialog placement="bottom" :open="addOpen" label="更多选项" @update:open="addOpen = $event">
    <div class="composer-sheet">
      <div class="composer-sheet__list">
        <button type="button" :disabled="isRunning || busy" @click="addOpen = false; fileInput.click()"><Icon name="paperclip" :size="20" /><span>添加文本或代码文件</span></button>
        <button type="button" :disabled="isRunning || busy || !sessionId" :title="!sessionId ? '发送一条消息创建会话后可以切换工作区' : isRunning ? '任务运行中不能切换工作区' : undefined" @click="openWorkspace"><Icon name="folder" :size="20" /><span>切换工作区</span></button>
      </div>
    </div>
  </Dialog>

  <Dialog placement="bottom" :open="workspaceOpen" label="切换工作区" @update:open="workspaceOpen = $event">
    <form class="workspace-picker" @submit.prevent="switchWorkspace">
      <p class="workspace-picker__current">当前目录：{{ currentWorkspace || '未设置' }}</p>
      <PathInput v-model="workspacePath" label="目录路径" placeholder="例如 /Users/yourname/projects/demo" mode="directory" />
      <p class="workspace-picker__hint">只切换当前会话的目录；对话历史、模型和设置都会保留。</p>
      <div v-if="recentWorkspaces.length" class="workspace-picker__recent">
        <span>最近目录</span>
        <button v-for="path in recentWorkspaces" :key="path" type="button" :title="path" @click="workspacePath = path">{{ path }}</button>
      </div>
      <p v-if="workspaceError" class="workspace-picker__error" role="alert">{{ workspaceError }}</p>
      <div class="dialog-actions">
        <Button type="button" :disabled="workspaceBusy" @click="workspaceOpen = false">取消</Button>
        <Button type="submit" :disabled="workspaceBusy || isRunning">{{ workspaceBusy ? '切换中…' : '切换到此目录' }}</Button>
      </div>
    </form>
  </Dialog>
</template>

<style scoped lang="scss" src="../../styles/components/composer/Composer.scss"></style>
