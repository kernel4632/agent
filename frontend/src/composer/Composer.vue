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
import { computed, nextTick, ref, watch } from 'vue'
import { AppIcon, Button, IconButton, Select } from '../ui/index.js'
import { store } from '../store.js'
import { UI } from '../commands/ui.js'
import ComposerAttachments from './ComposerAttachments.vue'
import ComposerSlashMenu from './ComposerSlashMenu.vue'

const props = defineProps({ selectedModel: { type: String, default: '' }, canSelectModel: Boolean, isRunning: Boolean, busy: Boolean, files: { type: Array, default: () => [] }, contextTokens: { type: Number, default: 0 } })
const draft = defineModel('draft', { type: String, default: '' })
const emit = defineEmits(['submit', 'stop', 'attach', 'remove-file'])
const fileInput = ref(null)
const editor = ref(null)
const models = computed(() => Object.entries(store.config.providers).flatMap(([provider, config]) => config.enabled ? config.models.map(model => ({ provider, model })) : []))
const selection = computed(() => JSON.stringify([store.config.activeProvider, store.config.activeModel]))
// 下拉框的 value 仍是 [供应商, 模型] 的 JSON 字符串，和原来原生 select 的取值方式一致。
const modelOptions = computed(() => models.value.map(item => ({
  value: JSON.stringify([item.provider, item.model]),
  label: `${item.provider} / ${item.model}`,
})))

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

// Select 只上抛字符串值，这里再解析回供应商和模型；和原来读 event.target.value 一样。
function chooseModel(value) {
  const [provider, model] = JSON.parse(value)
  store.config.activeProvider = provider
  store.config.activeModel = model
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
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); submit() }
}
function addFiles(event) { emit('attach', [...event.target.files]); event.target.value = '' }
defineExpose({ focus: () => editor.value?.focus() })
</script>

<template>
  <form class="chat-composer" aria-label="对话编辑器" @submit.prevent="submit">
    <ComposerAttachments :files="files" @remove="emit('remove-file', $event)" />
    <ComposerSlashMenu v-if="slashMatches.length" :matches="slashMatches" :active="slashIndex" @choose="chooseCommand" />
    <!-- 编辑器专用原生 textarea：需要 ref、焦点、键盘和斜杠菜单，等编辑器组件到位后再换。 -->
    <textarea ref="editor" v-model="draft" class="chat-composer__editor" aria-label="消息" :placeholder="store.commands?.length ? '输入消息与 AI 聊天，/ 使用命令' : '输入消息与 AI 聊天'" rows="2" @keydown="keydown"></textarea>
    <div class="chat-composer__toolbar">
      <div class="chat-composer__agent"><slot name="status"><AppIcon name="spark" :size="14" /><span>Build</span></slot></div>
      <div class="chat-composer__actions">
        <Select v-if="canSelectModel && models.length" class="chat-composer__model" label="新对话使用的模型" :model-value="selection" :options="modelOptions" :disabled="busy" @update:model-value="chooseModel" />
        <Button v-else-if="!selectedModel" variant="ghost" @click="UI.openSettings('providers')">连接模型</Button>
        <span v-else class="chat-composer__model" :title="selectedModel">{{ selectedModel }}</span>
        <IconButton label="添加文本附件" title="添加文本或代码文件" :disabled="isRunning || busy" @click="fileInput.click()"><AppIcon name="plus" :size="19" /></IconButton>
        <Button v-if="isRunning" variant="plain" class="chat-composer__send" type="button" aria-label="停止生成" @click="emit('stop')"><AppIcon name="stop" :size="15" /></Button>
        <Button v-else variant="plain" class="chat-composer__send" type="submit" aria-label="发送消息" :disabled="busy || !draft.trim() || !selectedModel"><AppIcon name="up" :size="18" /></Button>
      </div>
    </div>
    <!-- 隐藏的 file input 是编辑器专用控件：由上面的附件按钮触发，保留原生实现。 -->
    <input ref="fileInput" class="sr-only" type="file" multiple accept=".txt,.md,.js,.jsx,.ts,.tsx,.json,.css,.scss,.html,.vue,.py,.go,.rs,.yaml,.yml,.csv,.xml,.sh,.log" tabindex="-1" aria-label="选择文本附件" @change="addFiles" />
  </form>
  <div class="composer-footnote"><span>Enter 发送 · Shift + Enter 换行</span><span v-if="contextTokens">{{ contextTokens.toLocaleString() }} tokens</span><span v-else>请核实重要信息</span></div>
</template>

<style scoped lang="scss">
.chat-composer {
  position: relative;
  padding: 10px 12px 8px;
  border: .5px solid var(--la-line);
  border-radius: 24px;
  background: var(--la-layer-01);
  box-shadow: none;

  &:focus-within { border-color: var(--la-line-strong); }
  &__editor {
    display: block;
    width: 100%;
    min-height: 42px;
    max-height: 220px;
    padding: 2px 4px 8px;
    resize: none;
    field-sizing: content;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--la-text);
    font: 14px/21px var(--la-font-sans);
    letter-spacing: -.04px;

    &::placeholder { color: var(--la-muted); }
  }
  &__toolbar, &__actions, &__agent { display: flex; align-items: center; gap: 6px; min-width: 0; }
  &__toolbar { justify-content: space-between; gap: 8px; padding: 2px 2px 0; }
  &__actions { justify-content: flex-end; gap: 2px; }
  &__agent { color: var(--la-muted); font-size: 12px; }
  &__agent svg { color: var(--la-muted); }
  &__model {
    max-width: 230px;
    height: 30px;
    padding: 0 6px;
    overflow: hidden;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--la-secondary);
    font: 12px/20px var(--la-font-sans);
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  /* Select 的根节点负责限宽，内层 select 保持原来的透明、单行省略外观。 */
  &__model :deep(.ui-select__input) {
    width: 100%;
    height: 100%;
    padding: 0;
    overflow: hidden;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  &__model :deep(.ui-select__input:focus) { box-shadow: none; }
  &__model:hover { background: var(--la-layer-02); color: var(--la-text); }
  &__model :deep(.ui-select__input option) { background: var(--la-panel); color: var(--la-text); }
  &__send {
    display: grid;
    place-items: center;
    flex: 0 0 36px;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--la-accent-solid);
    color: #fff;
    cursor: pointer;
  }
  &__send:hover:not(:disabled) { background: color-mix(in srgb, var(--la-accent-solid) 88%, #000); }
  &__send:disabled { background: var(--la-layer-02); color: var(--la-muted); }
}
.composer-footnote { display: flex; justify-content: space-between; gap: 12px; padding: 6px 2px 0; color: var(--la-muted); font-size: 12px; font-weight: 440; }
@media (max-width: 767px) {
  .chat-composer {
    padding: 9px 10px 7px;
    &__editor { font-size: 16px; }
    &__agent span { display: none; }
    &__model { max-width: 150px; font-size: 12px; }
    &__send { width: 36px; height: 36px; flex-basis: 36px; }
  }
  .composer-footnote > span:first-child { display: none; }
  .composer-footnote { justify-content: center; }
}
</style>
