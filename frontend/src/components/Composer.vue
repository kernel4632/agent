<!--
会话输入区：消息输入、斜杠命令、附件、模型选择、发送和停止。
会话页和新建会话页共用；只通过 v-model:draft 和事件与外面交互。
模型面板独立在 ModelPicker；附件标签和斜杠菜单跟随同一份编辑状态。
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
import { Navigation } from '../commands/navigation.js'

import { computed, nextTick, ref, watch } from 'vue'
import { AppIcon, Button, Chip, ModelIcon, Sheet } from '../ui/index.js'
import { store } from '../store.js'
import { Session } from '../commands/session.js'
import ModelPicker from './ModelPicker.vue'
import ReasoningPicker from './ReasoningPicker.vue'
import { ATTACHMENT_ACCEPT } from '../commands/attachment.js'

const props = defineProps({
  selectedModel: { type: String, default: '' },
  selectedProvider: { type: String, default: '' },
  reasoning: { type: String, default: 'auto' },
  sessionId: { type: String, default: '' },
  agent: { type: String, default: '' },
  agentOpen: Boolean,
  showSessionControls: Boolean,
  isRunning: Boolean,
  canContinue: Boolean,
  busy: Boolean,
  files: { type: Array, default: () => [] },
})
const draft = defineModel('draft', { type: String, default: '' })
const emit = defineEmits(['submit', 'stop', 'continue', 'attach', 'remove-file', 'open-agent', 'update:reasoning'])
const fileInput = ref(null)
const editor = ref(null)
const currentProvider = computed(() => props.selectedProvider || store.config.activeProvider)
const modelOpen = ref(false)
const addOpen = ref(false)
const expanded = ref(false)
const placeholder = computed(() => store.commands?.length ? '输入消息与 AI 聊天，/ 使用命令' : '输入消息与 AI 聊天')

function toggleExpanded() {
  expanded.value = !expanded.value
  nextTick(() => editor.value?.focus())
}



async function chooseModel(provider, model) {
  modelOpen.value = false
  if (props.sessionId) await Session.selectModel(props.sessionId, provider, model)
  else {
    store.config.activeProvider = provider
    store.config.activeModel = model
  }
  nextTick(() => editor.value?.focus())
}

// --- 斜杠命令菜单 ---
const slashIndex = ref(0)
const slashDismissed = ref(false)
const slashMatches = computed(() => {
  if (slashDismissed.value || !store.commands?.length) return []
  // 只在输入框里只有 /名字 时给提示；输入参数后菜单自动收起。
  const match = draft.value.match(/^\/([a-zA-Z0-9_-]*)$/)
  if (!match) return []
  const query = match[1].toLowerCase()
  return store.commands.filter(item => item.name.toLowerCase().startsWith(query)).slice(0, 8)
})

watch(draft, () => {
  slashDismissed.value = false
  slashIndex.value = 0
})

// 选中命令只补全名字，参数由用户接着输入；发送时再展开正文。
function chooseCommand(command) {
  draft.value = `/${command.name} `
  slashDismissed.value = true
  nextTick(() => editor.value?.focus())
}

// 把 /name 参数 展开成命令正文；不认识的命令原样发送。
function expand(text) {
  const match = text.match(/^\/([a-zA-Z0-9_-]+)\s*([\s\S]*)$/)
  if (!match) return text
  const command = store.commands?.find(item => item.name === match[1])
  if (!command) return text
  const args = match[2].trim()
  if (command.prompt.includes('$ARGUMENTS')) return command.prompt.replaceAll('$ARGUMENTS', args)
  return args ? `${command.prompt}\n\n${args}` : command.prompt
}

function submit() {
  if (draft.value.trim() && props.selectedModel && !props.isRunning && !props.busy) emit('submit', expand(draft.value))
}
function keydown(event) {
  if (slashMatches.value.length) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      slashIndex.value = (slashIndex.value + 1) % slashMatches.value.length
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      slashIndex.value = (slashIndex.value - 1 + slashMatches.value.length) % slashMatches.value.length
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      chooseCommand(slashMatches.value[slashIndex.value])
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      slashDismissed.value = true
      return
    }
  }
  if (event.key === 'Escape' && expanded.value) {
    event.preventDefault()
    expanded.value = false
    return
  }
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); submit() }
}
function addFiles(event) { emit('attach', [...event.target.files]); event.target.value = '' }
defineExpose({ focus: () => editor.value?.focus() })
</script>

<template>
  <form class="chat-composer" :class="{ 'is-expanded': expanded }" aria-label="对话编辑器" @submit.prevent="submit">
    <Transition name="attachments">
      <div v-if="files.length" class="chat-composer__files">
        <Chip v-for="file in files" :key="file.id" class="chat-composer__file" closable :label="file.name" @close="emit('remove-file', file.id)">
          <AppIcon name="document" :size="16" />{{ file.name }}
        </Chip>
      </div>
    </Transition>
    <Transition name="slash">
      <div v-if="slashMatches.length" class="chat-composer__slash" role="listbox" aria-label="斜杠命令">
        <Button v-for="(command, index) in slashMatches" :key="command.name" variant="plain" class="chat-composer__slash-item" :class="{ 'is-active': index === slashIndex }" role="option" :aria-selected="index === slashIndex" @mousedown.prevent="chooseCommand(command)">
          <span class="chat-composer__slash-name">/{{ command.name }}</span>
          <span class="chat-composer__slash-description">{{ command.description }}</span>
        </Button>
      </div>
    </Transition>
    <!-- 消息编辑器直接使用原生输入，焦点和输入法组合状态由此处处理。 -->
    <div class="chat-composer__editor-wrap">
      <textarea ref="editor" v-model="draft" class="chat-composer__editor" aria-label="消息" :placeholder="placeholder" rows="2" @keydown="keydown"></textarea>
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
        <AppIcon :name="expanded ? 'collapse' : 'fullscreen'" :size="12" />
      </button>
    </div>
    <div class="chat-composer__bottom">
      <div class="chat-composer__options">
        <button type="button" class="composer-option composer-option--model" :aria-label="`选择模型（当前 ${selectedModel || '未选择'}）`" :title="selectedModel ? `选择模型：${selectedModel}` : '选择模型'" @click="modelOpen = true"><ModelIcon :model="selectedModel" :provider="currentProvider" :size="28" /></button>
        <ReasoningPicker :reasoning="reasoning" :disabled="!selectedModel" @update:reasoning="emit('update:reasoning', $event)" />
        <button v-if="showSessionControls" type="button" class="composer-agent" :class="{ 'is-open': agentOpen }"
          :aria-label="`切换智能体（当前 ${agent || '智能体'}）`" :title="`切换智能体（当前 ${agent || '智能体'}）`" @click="emit('open-agent')">
          <AppIcon name="mode" :size="18" />
          <span class="composer-agent__label">{{ agent || '智能体' }}</span>
        </button>
      </div>
      <div class="chat-composer__right">
        <button type="button" class="composer-action" aria-label="更多选项" title="更多选项" :disabled="busy" @click="addOpen = true"><AppIcon name="plus" :size="18" /></button>
        <Transition name="send" mode="out-in">
          <Button v-if="isRunning" key="stop" variant="plain" class="chat-composer__send is-stop" type="button" aria-label="停止生成" @click="emit('stop')"><AppIcon name="stop" :size="18" /></Button>
          <Button v-else-if="canContinue && !draft.trim()" key="continue" variant="plain" class="chat-composer__send is-continue" type="button" aria-label="继续助手" title="继续助手" :disabled="busy || !selectedModel" @click="emit('continue')"><AppIcon name="play" :size="18" /></Button>
          <Button v-else key="send" variant="plain" class="chat-composer__send" type="submit" aria-label="发送消息" :disabled="busy || !draft.trim() || !selectedModel"><AppIcon name="up" :size="18" /></Button>
        </Transition>
      </div>
    </div>
    <!-- 隐藏的 file input 是编辑器专用控件：由更多选项里的附件按钮触发，保留原生实现。 -->
    <input ref="fileInput" class="sr-only" type="file" multiple :accept="ATTACHMENT_ACCEPT" tabindex="-1" aria-label="选择文本附件" @change="addFiles" />
  </form>

  <ModelPicker v-model:open="modelOpen" :providers="store.config.providers" :model="selectedModel" :provider="currentProvider" @choose="chooseModel" @configure="Navigation.openSettings('providers')" />

  <Sheet :open="addOpen" label="更多选项" @update:open="addOpen = $event">
    <div class="composer-sheet">
      <div class="composer-sheet__list">
        <button type="button" :disabled="isRunning || busy" @click="addOpen = false; fileInput.click()"><AppIcon name="paperclip" :size="20" /><span>添加文本或代码文件</span></button>
        <button v-if="showSessionControls && sessionId" type="button" :title="agent ? `当前智能体：${agent}` : undefined" @click="addOpen = false; emit('open-agent')"><AppIcon name="eye" :size="20" /><span>切换智能体</span></button>
      </div>
    </div>
  </Sheet>
</template>

<style scoped lang="scss" src="../styles/components/Composer.scss"></style>
