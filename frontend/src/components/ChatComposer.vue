<script setup>
import { ref } from 'vue'
import AppIcon from './AppIcon.vue'
const props = defineProps({ selectedModel: { type: String, default: '' }, isRunning: Boolean, files: { type: Array, default: () => [] }, contextTokens: { type: Number, default: 0 } })
const draft = defineModel('draft', { type: String, default: '' })
const emit = defineEmits(['submit', 'stop', 'attach', 'remove-file', 'settings'])
const fileInput = ref(null)
function submit() { if (draft.value.trim() && !props.isRunning) emit('submit', draft.value) }
function keydown(event) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); submit() }
}
function addFiles(event) { emit('attach', [...event.target.files]); event.target.value = '' }
</script>

<template>
  <div class="composer-area">
    <form class="chat-composer" aria-label="对话编辑器" @submit.prevent="submit">
      <div v-if="files.length" class="chat-composer__files"><span v-for="file in files" :key="file.id"><AppIcon name="document" :size="14" />{{ file.name }}<button type="button" :aria-label="`移除附件 ${file.name}`" @click="emit('remove-file', file.id)"><AppIcon name="close" :size="12" /></button></span></div>
      <textarea v-model="draft" class="chat-composer__editor" aria-label="消息" placeholder="输入消息，让想法更进一步…" rows="2" @keydown="keydown"></textarea>
      <div class="chat-composer__toolbar">
        <div class="chat-composer__tools"><button class="icon-button" type="button" aria-label="添加文本附件" title="添加文本或代码附件（每个不超过 1 MiB）" :disabled="isRunning" @click="fileInput.click()"><AppIcon name="plus" :size="20" /></button><span class="composer-separator"></span><span class="chat-composer__mode"><AppIcon name="spark" :size="15" />Agent</span></div>
        <div class="chat-composer__actions"><span class="chat-composer__model" :title="selectedModel ? '当前后端不支持切换会话模型；请在首页选择模型后新建对话' : '尚未配置模型'"><span class="status-dot" :class="{ inactive: !selectedModel }"></span>{{ selectedModel || '未配置模型' }}</span><button v-if="isRunning" class="chat-composer__send" type="button" aria-label="停止生成" title="停止生成" @click="emit('stop')"><AppIcon name="stop" :size="17" /></button><button v-else class="chat-composer__send" type="submit" aria-label="发送消息" title="发送消息" :disabled="!draft.trim() || !selectedModel"><AppIcon name="up" :size="19" /></button></div>
      </div>
      <input ref="fileInput" class="sr-only" type="file" multiple accept=".txt,.md,.js,.jsx,.ts,.tsx,.json,.css,.scss,.html,.vue,.py,.go,.rs,.yaml,.yml,.csv,.xml,.sh,.log" tabindex="-1" aria-label="选择文本附件" @change="addFiles" />
    </form>
    <div class="composer-footnote"><span>Enter 发送 <i>·</i> Shift + Enter 换行</span><span v-if="contextTokens">上下文 {{ contextTokens.toLocaleString() }} tokens</span><span v-else>AI 也可能出错，请核实重要信息</span></div>
  </div>
</template>

<style scoped lang="scss">
.chat-composer { padding: 18px 16px 12px; border: 1px solid var(--la-accent-border); border-radius: 17px; background: var(--la-input); box-shadow: 0 8px 40px #03071320; transition: border-color .2s; }
.chat-composer:focus-within { border-color: #a5c3fd66; }
.chat-composer__editor { display: block; width: 100%; min-height: 55px; max-height: 220px; field-sizing: content; resize: none; border: 0; outline: none; padding: 2px 4px 12px; background: transparent; color: var(--la-text); font-size: 13px; line-height: 1.8; }
.chat-composer__editor::placeholder { color: var(--la-muted); }
.chat-composer__toolbar, .chat-composer__tools, .chat-composer__actions { display: flex; align-items: center; gap: 10px; min-width: 0; }
.chat-composer__toolbar { justify-content: space-between; }
.chat-composer__mode { display: flex; align-items: center; gap: 6px; color: var(--la-secondary); font-size: 11px; }
.chat-composer__mode svg { color: #dfb796; }
.composer-separator { height: 14px; width: 1px; background: var(--la-line); }
.chat-composer__model { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--la-secondary); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; max-width: 280px; }
.inactive { background: var(--la-muted); }
.chat-composer__send { width: 34px; height: 34px; flex: 0 0 34px; display: grid; place-items: center; border-radius: 10px; border: 0; color: #182844; background: #b2cdf9; cursor: pointer; }
.chat-composer__send:hover { background: #ccdeff; }
.chat-composer__send:disabled { background: var(--la-hover); color: var(--la-muted); }
.composer-footnote { display: flex; justify-content: space-between; gap: 10px; margin: 12px 4px 0; color: var(--la-muted); font-size: 9px; }
.composer-footnote i { margin: 0 4px; font-style: normal; }
.chat-composer__files { display: flex; gap: 6px; flex-wrap: wrap; margin: 0 4px 12px; }
.chat-composer__files > span { max-width: 100%; display: flex; align-items: center; gap: 6px; font-size: 10px; padding: 6px 8px; border-radius: 6px; background: var(--la-hover); color: var(--la-secondary); overflow-wrap: anywhere; }
.chat-composer__files button { display: grid; place-items: center; border: 0; background: none; color: inherit; cursor: pointer; padding: 4px; }
@media (max-width: 760px) { .chat-composer { padding: 14px 11px 10px; } .chat-composer__send { width: 40px; height: 40px; flex-basis: 40px; } .chat-composer__model { max-width: 130px; font-size: 10px; } .composer-footnote { justify-content: center; } .composer-footnote > span:first-child { display: none; } .chat-composer__editor { font-size: 16px; } }
</style>
