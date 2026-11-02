<!--
会话输入区：消息输入、斜杠命令、附件、模型选择、发送和停止。
会话页和新建会话页共用；只通过 v-model:draft 和事件与外面交互。
消息编辑器和隐藏的 file input 是编辑器专用控件，保留原生实现，等后续编辑器组件到位后再替换。
调用示例：
<Composer
  ref="composer"
  v-model:draft="draft"
  :selected-model="model"
  :can-select-model="false"
  :is-running="false"
  :busy="false"
  :files="files"
  :context-tokens="0"
  @submit="submitMessage"
  @stop="stop"
  @attach="attachFiles"
  @remove-file="removeFile"
/>
-->
<script setup>
import { Navigation } from '../commands/navigation.js'

import { computed, nextTick, ref, watch } from 'vue'
import { AppIcon, Button, Field, ModelIcon, Sheet } from '../ui/index.js'
import { store } from '../store.js'
import { Session } from '../commands/session.js'
import ComposerAttachments from './ComposerAttachments.vue'
import ComposerSlashMenu from './ComposerSlashMenu.vue'
import ReasoningPicker from './ReasoningPicker.vue'
import AgentButton from './AgentButton.vue'
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
const modelGroups = computed(() => Object.entries(store.config.providers)
  .filter(([, config]) => config.enabled)
  .map(([provider, config]) => ({
    provider,
    models: config.models
      .map(model => typeof model === 'string' ? model : model.id || model.name)
      .filter(model => !modelQuery.value.trim() || model.toLowerCase().includes(modelQuery.value.trim().toLowerCase())),
  }))
  .filter(group => group.models.length))

const modelOpen = ref(false)
const modelQuery = ref('')
const addOpen = ref(false)
const expanded = ref(false)
const placeholder = computed(() => store.commands?.length ? '输入消息与 AI 聊天，/ 使用命令' : '输入消息与 AI 聊天')

function toggleExpanded() {
  expanded.value = !expanded.value
  nextTick(() => editor.value?.focus())
}

function openModelSheet() {
  modelQuery.value = ''
  modelOpen.value = true
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
    <ComposerAttachments :files="files" @remove="emit('remove-file', $event)" />
    <Transition name="slash">
      <ComposerSlashMenu v-if="slashMatches.length" :matches="slashMatches" :active="slashIndex" @choose="chooseCommand" />
    </Transition>
    <!-- 编辑器专用原生 textarea：需要 ref、焦点、键盘和斜杠菜单，等编辑器组件到位后再换。 -->
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
        <button type="button" class="composer-option composer-option--model" :aria-label="`选择模型（当前 ${selectedModel || '未选择'}）`" :title="selectedModel ? `选择模型：${selectedModel}` : '选择模型'" @click="openModelSheet"><ModelIcon :model="selectedModel" :provider="currentProvider" :size="28" /></button>
        <ReasoningPicker :reasoning="reasoning" :disabled="!selectedModel" @update:reasoning="emit('update:reasoning', $event)" />
        <template v-if="showSessionControls">
          <AgentButton :agent="agent" :open="agentOpen" @open="emit('open-agent')" />
        </template>
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

  <Sheet :open="modelOpen" label="选择模型" @update:open="modelOpen = $event">
    <div class="composer-sheet composer-sheet--models">
      <Field v-model="modelQuery" type="search" label="搜索模型" placeholder="搜索模型">
        <template #leading><AppIcon name="search" :size="20" /></template>
      </Field>
      <div v-if="modelGroups.length" class="model-list">
        <section v-for="group in modelGroups" :key="group.provider" class="model-group">
          <h3>{{ group.provider }}</h3>
          <button v-for="model in group.models" :key="model" type="button" class="model-row" :class="{ 'is-selected': model === selectedModel && group.provider === currentProvider }" :aria-pressed="model === selectedModel && group.provider === currentProvider" @click="chooseModel(group.provider, model)">
            <span class="model-row__icon"><ModelIcon :model="model" :provider="group.provider" :size="28" /></span>
            <span class="model-row__name">{{ model }}</span>
            <AppIcon v-if="model === selectedModel && group.provider === currentProvider" name="check" :size="20" />
          </button>
        </section>
      </div>
      <div v-else class="composer-sheet__empty">
        <p>还没有可用模型。</p>
        <Button @click="modelOpen = false; Navigation.openSettings('providers')">打开模型设置</Button>
      </div>
    </div>
  </Sheet>

  <Sheet :open="addOpen" label="更多选项" @update:open="addOpen = $event">
    <div class="composer-sheet">
      <div class="composer-sheet__list">
        <button type="button" :disabled="isRunning || busy" @click="addOpen = false; fileInput.click()"><AppIcon name="paperclip" :size="20" /><span>添加文本或代码文件</span></button>
        <button v-if="showSessionControls && sessionId" type="button" :title="agent ? `当前智能体：${agent}` : undefined" @click="addOpen = false; emit('open-agent')"><AppIcon name="eye" :size="20" /><span>切换智能体</span></button>
      </div>
    </div>
  </Sheet>
</template>

<style scoped lang="scss" src="../styles/composer/Composer.scss"></style>
