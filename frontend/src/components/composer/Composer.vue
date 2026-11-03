<!--
会话输入区：消息输入、附件、模型选择、发送和停止。
会话页和新建会话页共用；只通过 v-model:draft 和事件与外面交互。
模型面板独立在 ModelPicker；附件标签跟随同一份编辑状态。
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
import { store } from '../../store.js'
import { Session } from '../../commands/session.js'
import ModelPicker from './ModelPicker.vue'
import ReasoningPicker from './ReasoningPicker.vue'
import { ATTACHMENT_ACCEPT } from '../../commands/attachment.js'

const props = defineProps({
  selectedModel: { type: String, default: '' },
  selectedProvider: { type: String, default: '' },
  reasoning: { type: String, default: 'auto' },
  sessionId: { type: String, default: '' },
  isRunning: Boolean,
  canContinue: Boolean,
  busy: Boolean,
  files: { type: Array, default: () => [] },
})
const draft = defineModel('draft', { type: String, default: '' })
const emit = defineEmits(['submit', 'stop', 'continue', 'attach', 'remove-file', 'update:reasoning'])
const fileInput = ref(null)
const editor = ref(null)
const currentProvider = computed(() => props.selectedProvider || store.config.activeProvider)
const modelOpen = ref(false)
const addOpen = ref(false)
const expanded = ref(false)

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
defineExpose({ focus: () => editor.value?.focus() })
</script>

<template>
  <form class="chat-composer" :class="{ 'is-expanded': expanded }" aria-label="对话编辑器" @submit.prevent="submit">
    <Transition name="attachments">
      <div v-if="files.length" class="chat-composer__files">
        <Chip v-for="file in files" :key="file.id" class="chat-composer__file" closable :label="file.name" @close="emit('remove-file', file.id)">
          <Icon name="document" :size="16" />{{ file.name }}
        </Chip>
      </div>
    </Transition>
    <!-- 消息编辑器直接使用原生输入，焦点和输入法组合状态由此处处理。 -->
    <div class="chat-composer__editor-wrap">
      <textarea ref="editor" v-model="draft" class="chat-composer__editor" aria-label="消息" placeholder="输入消息与 AI 聊天" rows="2" @keydown="keydown"></textarea>
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
        <button type="button" class="composer-option composer-option--model" :aria-label="`选择模型（当前 ${selectedModel || '未选择'}）`" :title="selectedModel ? `选择模型：${selectedModel}` : '选择模型'" @click="modelOpen = true"><Icon name="model" :size="28" /></button>
        <ReasoningPicker :reasoning="reasoning" :disabled="!selectedModel" @update:reasoning="emit('update:reasoning', $event)" />
        <button type="button" class="composer-option composer-option--permission" aria-label="工具权限" title="打开工具权限设置" @click="Navigation.openSettings('tools')"><Icon name="permission" :size="18" /><span>权限</span></button>
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

  <ModelPicker v-model:open="modelOpen" :providers="store.config.providers" :model="selectedModel" :provider="currentProvider" @choose="chooseModel" @configure="Navigation.openSettings('providers')" />

  <Dialog placement="bottom" :open="addOpen" label="更多选项" @update:open="addOpen = $event">
    <div class="composer-sheet">
      <div class="composer-sheet__list">
        <button type="button" :disabled="isRunning || busy" @click="addOpen = false; fileInput.click()"><Icon name="paperclip" :size="20" /><span>添加文本或代码文件</span></button>
      </div>
    </div>
  </Dialog>
</template>

<style scoped lang="scss" src="../../styles/components/composer/Composer.scss"></style>
