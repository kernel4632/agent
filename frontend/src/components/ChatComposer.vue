<script setup>
import { computed, ref } from 'vue'
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

function chooseModel(event) {
  const [provider, model] = JSON.parse(event.target.value)
  store.config.activeProvider = provider
  store.config.activeModel = model
}
function submit() {
  if (draft.value.trim() && props.selectedModel && !props.isRunning && !props.busy) emit('submit', draft.value)
}
function keydown(event) {
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
      <textarea ref="editor" v-model="draft" class="chat-composer__editor" aria-label="消息" placeholder="输入消息与 AI 聊天" rows="2" @keydown="keydown"></textarea>
      <div class="chat-composer__toolbar">
        <span class="chat-composer__agent"><AppIcon name="spark" :size="17" /><span>Agent</span></span>
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
  padding: 16px 16px 10px;
  border: 1px solid var(--la-line);
  border-radius: var(--la-radius-panel);
  background: var(--la-input);

  &:focus-within { border-color: var(--la-accent-border); }
  &__editor {
    display: block;
    width: 100%;
    min-height: 54px;
    max-height: 220px;
    padding: 0 2px 12px;
    resize: none;
    field-sizing: content;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--la-text);
    font-size: 14px;
    line-height: 1.8;

    &::placeholder { color: var(--la-secondary); }
  }
  &__toolbar, &__actions, &__agent { display: flex; align-items: center; gap: 8px; min-width: 0; }
  &__toolbar { justify-content: space-between; }
  &__agent { color: var(--la-muted); font-size: 12px; }
  &__agent svg { color: var(--la-muted); }
  &__model { max-width: 230px; overflow: hidden; border: 0; background: transparent; color: var(--la-secondary); font: 11px/1.6 var(--la-font-mono); text-overflow: ellipsis; white-space: nowrap; }
  &__model option { background: var(--la-panel); color: var(--la-text); }
  &__send { display: grid; place-items: center; flex: 0 0 30px; width: 30px; height: 30px; padding: 0; border: 0; border-radius: var(--la-radius); background: var(--la-action); color: var(--la-on-action); cursor: pointer; }
  &__send:disabled { background: var(--la-hover); color: var(--la-secondary); }
  &__files { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
  &__files > span { display: flex; align-items: center; gap: 6px; max-width: 100%; padding-left: 9px; border: 1px solid var(--la-line); border-radius: 6px; color: var(--la-secondary); font-size: 12px; overflow-wrap: anywhere; }
}
.composer-footnote { display: flex; justify-content: space-between; gap: 12px; padding: 10px 4px 0; color: var(--la-muted); font-size: 10px; }
@media (max-width: 760px) {
  .chat-composer {
    padding: 14px 12px 8px;
    &__editor { font-size: 16px; }
    &__agent span { display: none; }
    &__model { max-width: 150px; font-size: 11px; }
    &__send { width: 40px; height: 40px; flex-basis: 40px; }
  }
  .composer-footnote > span:first-child { display: none; }
  .composer-footnote { justify-content: center; }
}
</style>
