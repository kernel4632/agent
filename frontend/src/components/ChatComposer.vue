<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { store } from '../store.js'
import { UI } from '../commands/ui.js'

const props = defineProps({ selectedModel: { type: String, default: '' }, canSelectModel: Boolean, isRunning: Boolean, busy: Boolean, files: { type: Array, default: () => [] }, contextTokens: { type: Number, default: 0 } })
const draft = defineModel('draft', { type: String, default: '' })
const emit = defineEmits(['submit', 'stop', 'attach', 'remove-file'])
const fileInput = ref(null)
const editor = ref(null)
const models = computed(() => Object.entries(store.config.providers).flatMap(([provider, config]) => config.enabled ? config.models.map(model => ({ provider, model })) : []))
const selection = computed(() => JSON.stringify([store.config.activeProvider, store.config.activeModel]))

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

function chooseModel(event) {
  const [provider, model] = JSON.parse(event.target.value)
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
  <div class="composer-area">
    <form class="chat-composer" aria-label="对话编辑器" @submit.prevent="submit">
      <div v-if="files.length" class="chat-composer__files">
        <span v-for="file in files" :key="file.id"><AppIcon name="document" :size="14" />{{ file.name }}<button type="button" class="icon-button" :aria-label="`移除附件 ${file.name}`" @click="emit('remove-file', file.id)"><AppIcon name="close" :size="13" /></button></span>
      </div>
      <div v-if="slashMatches.length" class="chat-composer__slash" role="listbox" aria-label="斜杠命令">
        <button v-for="(command, index) in slashMatches" :key="command.name" type="button" class="chat-composer__slash-item" :class="{ 'is-active': index === slashIndex }" role="option" :aria-selected="index === slashIndex" @mousedown.prevent="chooseCommand(command)">
          <span class="chat-composer__slash-name">/{{ command.name }}</span>
          <span class="chat-composer__slash-description">{{ command.description }}</span>
        </button>
      </div>
      <textarea ref="editor" v-model="draft" class="chat-composer__editor" aria-label="消息" :placeholder="store.commands?.length ? '输入消息与 AI 聊天，/ 使用命令' : '输入消息与 AI 聊天'" rows="2" @keydown="keydown"></textarea>
      <div class="chat-composer__toolbar">
        <div class="chat-composer__agent"><slot name="status"><AppIcon name="spark" :size="14" /><span>Build</span></slot></div>
        <div class="chat-composer__actions">
          <select v-if="canSelectModel && models.length" class="chat-composer__model" aria-label="新对话使用的模型" :value="selection" :disabled="busy" @change="chooseModel">
            <option v-for="item in models" :key="JSON.stringify(item)" :value="JSON.stringify([item.provider, item.model])">{{ item.provider }} / {{ item.model }}</option>
          </select>
          <button v-else-if="!selectedModel" type="button" class="text-button" @click="UI.openSettings('providers')">连接模型</button>
          <span v-else class="chat-composer__model" :title="selectedModel">{{ selectedModel }}</span>
          <button class="icon-button" type="button" aria-label="添加文本附件" title="添加文本或代码文件" :disabled="isRunning || busy" @click="fileInput.click()"><AppIcon name="plus" :size="19" /></button>
          <button v-if="isRunning" class="chat-composer__send" type="button" aria-label="停止生成" @click="emit('stop')"><AppIcon name="stop" :size="15" /></button>
          <button v-else class="chat-composer__send" type="submit" aria-label="发送消息" :disabled="busy || !draft.trim() || !selectedModel"><AppIcon name="up" :size="18" /></button>
        </div>
      </div>
      <input ref="fileInput" class="sr-only" type="file" multiple accept=".txt,.md,.js,.jsx,.ts,.tsx,.json,.css,.scss,.html,.vue,.py,.go,.rs,.yaml,.yml,.csv,.xml,.sh,.log" tabindex="-1" aria-label="选择文本附件" @change="addFiles" />
    </form>
    <div class="composer-footnote"><span>Enter 发送 · Shift + Enter 换行</span><span v-if="contextTokens">{{ contextTokens.toLocaleString() }} tokens</span><span v-else>请核实重要信息</span></div>
  </div>
</template>

<style scoped lang="scss">
.chat-composer {
  position: relative;
  padding: 12px 14px 8px;
  border: .5px solid var(--la-line);
  border-radius: 10px;
  background: var(--la-layer-01);
  box-shadow: var(--la-shadow-raised);

  &:focus-within { border-color: var(--la-line-strong); }
  &__slash {
    position: absolute;
    right: 0;
    bottom: calc(100% + 8px);
    left: 0;
    z-index: 20;
    display: grid;
    max-height: 240px;
    padding: 4px;
    overflow-y: auto;
    gap: 1px;
    border-radius: 8px;
    background: var(--la-layer-01);
    box-shadow: var(--la-shadow-floating);
  }
  &__slash-item {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 7px 9px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--la-secondary);
    text-align: left;
    cursor: pointer;
  }
  &__slash-item.is-active, &__slash-item:hover { background: var(--la-hover); color: var(--la-text); }
  &__slash-name { flex: none; color: var(--la-accent); font: 12px/1.6 var(--la-font-mono); white-space: nowrap; }
  &__slash-description { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
  &__editor {
    display: block;
    width: 100%;
    min-height: 44px;
    max-height: 220px;
    padding: 0 0 8px;
    resize: none;
    field-sizing: content;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--la-text);
    font: 13px/20px var(--la-font-sans);
    letter-spacing: -.04px;

    &::placeholder { color: var(--la-muted); }
  }
  &__toolbar, &__actions, &__agent { display: flex; align-items: center; gap: 6px; min-width: 0; }
  &__toolbar { justify-content: space-between; padding-top: 6px; border-top: .5px solid var(--la-line); }
  &__agent { color: var(--la-muted); font-size: 12px; }
  &__agent svg { color: var(--la-muted); }
  &__model {
    max-width: 230px;
    height: 28px;
    padding: 0 4px;
    overflow: hidden;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--la-secondary);
    font: 12px/20px var(--la-font-sans);
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  &__model:hover { background: var(--la-layer-02); color: var(--la-text); }
  &__model option { background: var(--la-panel); color: var(--la-text); }
  &__send {
    display: grid;
    place-items: center;
    flex: 0 0 28px;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: var(--la-accent-solid);
    color: #fff;
    cursor: pointer;
  }
  &__send:hover:not(:disabled) { background: color-mix(in srgb, var(--la-accent-solid) 88%, #000); }
  &__send:disabled { background: var(--la-layer-02); color: var(--la-muted); }
  &__files { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  &__files > span { display: flex; align-items: center; gap: 6px; max-width: 100%; padding-left: 8px; border-radius: 6px; background: var(--la-layer-02); color: var(--la-secondary); font-size: 12px; overflow-wrap: anywhere; }
}
.composer-footnote { display: flex; justify-content: space-between; gap: 12px; padding: 6px 2px 0; color: var(--la-muted); font-size: 12px; font-weight: 440; }
@media (max-width: 767px) {
  .chat-composer {
    padding: 10px 12px 8px;
    &__editor { font-size: 16px; }
    &__agent span { display: none; }
    &__model { max-width: 150px; font-size: 12px; }
    &__send { width: 32px; height: 32px; flex-basis: 32px; }
  }
  .composer-footnote > span:first-child { display: none; }
  .composer-footnote { justify-content: center; }
}
</style>
