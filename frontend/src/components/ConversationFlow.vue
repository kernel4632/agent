<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { store } from '../store.js'
import { Chat } from '../commands/chat.js'
import { UI } from '../commands/ui.js'
import { renderMarkdown } from '../utils/markdown.js'
import 'highlight.js/styles/github-dark.css'
import 'katex/dist/katex.min.css'

const root = ref(null)
const session = computed(() => store.sessions[store.ui.activeSessionID])
const messages = computed(() => session.value?.messages || [])
const pinned = ref(true)
const rollbackTarget = ref(null)
const rollbackDialog = ref(null)
let scrollParent
function onScroll() { pinned.value = scrollParent.scrollHeight - scrollParent.scrollTop - scrollParent.clientHeight < 100 }
function scrollToBottom() { nextTick(() => { if (pinned.value && scrollParent) scrollParent.scrollTop = scrollParent.scrollHeight }) }
watch(messages, scrollToBottom, { deep: true })
onMounted(() => { scrollParent = root.value.closest('.chat-page__scroll'); scrollParent?.addEventListener('scroll', onScroll, { passive: true }); scrollToBottom() })
onBeforeUnmount(() => scrollParent?.removeEventListener('scroll', onScroll))
function requestRollback(message) { rollbackTarget.value = message; rollbackDialog.value.showModal() }
async function confirmRollback() { if (await Chat.rollbackMessage(session.value.id, rollbackTarget.value.id)) rollbackDialog.value?.close() }
const toolLabel = status => ({ waiting: '等待你的许可', running: '正在执行', completed: '已完成', error: '执行失败', rejected: '已拒绝' }[status] || '等待结果')
</script>

<template>
  <div ref="root" class="conversation-flow" aria-label="对话内容">
    <section v-for="message in messages" :key="message.id" class="message" :class="`message--${message.role}`" :aria-label="message.role === 'user' ? '你的消息' : 'la 的回复'">
      <header class="message__author"><span v-if="message.role === 'assistant'" class="message__avatar"><AppIcon name="spark" :size="16" /></span><span v-else class="message__avatar message__avatar--user"><AppIcon name="globe" :size="16" /></span><strong>{{ message.role === 'user' ? '你' : 'la' }}</strong><span v-if="message.role === 'assistant'" class="message__model">{{ session.model }}</span></header>
      <div v-if="message.role === 'user'" class="message__bubble">{{ message.content }}</div>
      <template v-else>
        <details v-if="message.reasoning" class="reasoning"><summary><AppIcon name="spark" :size="14" />思考过程<AppIcon name="down" :size="13" /></summary><p>{{ message.reasoning }}</p></details>
        <div v-if="message.content" class="markdown-body" v-html="renderMarkdown(message.content)"></div>
        <div v-if="message.isStreaming && !message.content" class="typing" role="status"><span></span><span></span><span></span><small>{{ message.retry || '正在思考' }}</small></div>
        <details v-for="tool in message.tools || []" :key="tool.id" class="tool-card" :open="tool.status === 'waiting' || tool.status === 'running'">
          <summary><AppIcon name="code" :size="16" /><strong>{{ tool.name }}</strong><span :class="{ 'tool-warning': tool.status === 'waiting' }">{{ toolLabel(tool.status) }}</span><AppIcon name="down" :size="14" /></summary>
          <div class="tool-card__body"><pre v-if="Object.keys(tool.input || {}).length">{{ JSON.stringify(tool.input, null, 2) }}</pre><pre v-if="tool.preview">{{ tool.preview }}</pre><div v-if="tool.status === 'waiting'" class="approval"><p>此操作需要你的许可。请检查上方工具及参数。</p><div><button class="button button--danger" :disabled="tool.deciding" @click="Chat.decide(session.id, tool.id, 'deny')">拒绝</button><button class="button" :disabled="tool.deciding" @click="Chat.decide(session.id, tool.id, 'always-allow')">始终允许此参数</button><button class="button button--primary" :disabled="tool.deciding" @click="Chat.decide(session.id, tool.id, 'allow-once')">允许一次</button></div></div></div>
        </details>
        <p v-if="message.error" class="message__error" role="alert"><AppIcon name="info" :size="16" />{{ message.error }}</p>
        <div v-if="message.request?.input || message.request?.output" class="message__usage">输入 {{ message.request.input.toLocaleString() }} <span>·</span>输出 {{ message.request.output.toLocaleString() }} tokens</div>
      </template>
      <div v-if="!message.isStreaming" class="message__actions"><button class="icon-button" aria-label="复制消息" title="复制消息" @click="UI.copy(message.content)"><AppIcon name="copy" :size="14" /></button><button v-if="message.role === 'user' && !message.id.startsWith('pending_')" class="icon-button" aria-label="回退到此消息" title="回退到此消息之前" :disabled="session.status === 'running'" @click="requestRollback(message)"><AppIcon name="undo" :size="14" /></button></div>
    </section>
    <dialog ref="rollbackDialog" class="dialog" aria-label="确认回退"><h2>回到这条消息之前？</h2><p>此消息及之后的内容将从当前对话中回退。你可以在发送新消息前撤销此次回退。</p><div class="dialog-actions"><button class="button" @click="rollbackDialog.close()">取消</button><button class="button button--primary" @click="confirmRollback">确认回退</button></div></dialog>
  </div>
</template>

<style scoped lang="scss">
.conversation-flow { width: 100%; margin: 0; padding: 28px var(--la-chat-gutter); display: flex; flex-direction: column; gap: 26px; }
.message { min-width: 0; }
.message__author { display: flex; align-items: center; gap: 9px; margin-bottom: 12px; font-size: 12px; }
.message__author strong { font-weight: 500; }
.message__avatar { width: 28px; height: 28px; display: grid; place-items: center; background: var(--la-hover); border: 1px solid var(--la-line); border-radius: var(--la-radius); color: var(--la-secondary); }
.message__avatar--user { color: var(--la-secondary); background: var(--la-hover); }
.message__model { font: 10px/1.6 var(--la-font-mono); color: var(--la-muted); }
.message--user { display: flex; flex-direction: column; align-items: flex-end; }
.message--user .message__author { flex-direction: row-reverse; }
.message__bubble { max-width: 85%; padding: 11px 13px; font-size: 13px; line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid var(--la-line); border-radius: var(--la-radius-panel); background: var(--la-setting-row); }
.message__actions { display: flex; gap: 2px; margin-top: 7px; opacity: .55; }
.message:hover .message__actions, .message:focus-within .message__actions { opacity: 1; }
.message__actions .icon-button { width: 30px; height: 30px; }
.markdown-body { color: var(--la-text); font-size: 13px; line-height: 1.95; overflow-wrap: anywhere; }
.markdown-body :deep(p) { margin: 0 0 14px; }
.markdown-body :deep(h1), .markdown-body :deep(h2), .markdown-body :deep(h3) { line-height: 1.5; font-weight: 550; margin: 22px 0 12px; }
.markdown-body :deep(h1) { font-size: 23px; } .markdown-body :deep(h2) { font-size: 19px; } .markdown-body :deep(h3) { font-size: 16px; }
.markdown-body :deep(pre) { max-width: 100%; overflow-x: auto; border: 1px solid var(--la-line); padding: 14px; border-radius: var(--la-radius-panel); background: #0b0e14; color: #dfe3ea; line-height: 1.7; }
.markdown-body :deep(code) { font: 12px/1.7 "Cascadia Code", Consolas, monospace; }
.markdown-body :deep(:not(pre) > code) { padding: 2px 5px; background: var(--la-hover); border: 1px solid var(--la-line); border-radius: 4px; color: var(--la-accent); }
.markdown-body :deep(a) { color: var(--la-accent); text-underline-offset: 4px; }
.markdown-body :deep(img) { max-width: 100%; height: auto; border-radius: 8px; }
.markdown-body :deep(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
.markdown-body :deep(td), .markdown-body :deep(th) { padding: 8px 12px; border: 1px solid var(--la-line); }
.markdown-body :deep(blockquote) { margin-left: 0; padding-left: 16px; border-left: 2px solid var(--la-accent-border); color: var(--la-secondary); }
.markdown-body :deep(.katex-display) { overflow-x: auto; overflow-y: hidden; }
.reasoning { padding: 10px 13px; margin-bottom: 16px; border: 1px solid var(--la-line); border-radius: 8px; color: var(--la-muted); font-size: 11px; }
.reasoning summary { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.reasoning p { margin: 12px 0 0; white-space: pre-wrap; line-height: 1.8; }
.typing { display: flex; align-items: center; gap: 4px; height: 32px; color: var(--la-muted); }
.typing > span { width: 4px; height: 4px; background: var(--la-accent); border-radius: 50%; animation: pulse 1.3s infinite alternate; }
.typing > span:nth-child(2) { animation-delay: .2s; } .typing > span:nth-child(3) { animation-delay: .4s; }
.typing small { margin-left: 8px; font-size: 11px; }
@keyframes pulse { to { opacity: .2; transform: translateY(-2px); } }
.tool-card { border: 1px solid var(--la-line); background: var(--la-hover); border-radius: 7px; margin: 12px 0; overflow: hidden; }
.tool-card summary { display: flex; align-items: center; gap: 10px; padding: 13px; font-size: 11px; cursor: pointer; }
.tool-card summary strong { font-weight: 500; overflow-wrap: anywhere; }
.tool-card summary > span { margin-left: auto; color: var(--la-muted); white-space: nowrap; font-size: 10px; }
.tool-card summary > span.tool-warning { color: #d9ba8a; }
.tool-card__body { padding: 0 14px 14px; }
.tool-card pre { font: 11px/1.8 "Cascadia Code",Consolas,monospace; max-height: 320px; overflow: auto; margin: 0 0 12px; color: var(--la-secondary); }
.approval p { font-size: 11px; color: var(--la-secondary); }
.approval > div { display: flex; flex-wrap: wrap; gap: 8px; }
.approval .button { min-height: 34px; font-size: 11px; }
.message__error { display: flex; align-items: flex-start; gap: 8px; color: var(--la-danger); font-size: 12px; line-height: 1.8; padding: 10px 0; overflow-wrap: anywhere; }
.message__error > svg { flex-shrink: 0; margin-top: 3px; }
.message__usage { font-size: 9px; color: var(--la-muted); margin-top: 14px; }
.message__usage > span { padding: 0 7px; }
@media (max-width: 760px) { .conversation-flow { padding: 22px 16px; gap: 23px; } .message__bubble { max-width: 95%; } .message__model { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
</style>
