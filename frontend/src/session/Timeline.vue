<!--
会话时间线：按顺序显示消息、思考过程、工具调用与审批，以及回退和分支操作。
只被会话页使用；自己从 store 读当前会话，不需要传 props。
按钮和图标按钮走 ui/；回退勾选框暂留原生，等 checkbox / switch 控件到位后再换。
调用示例：
<Timeline :key="session.id" />
-->
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '../ui/AppIcon.vue'
import Button from '../ui/Button.vue'
import IconButton from '../ui/IconButton.vue'
import { store } from '../store.js'
import { Chat } from '../commands/chat.js'
import { Session } from '../commands/session.js'
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
const rollbackPreview = ref(null)
const rollbackFiles = ref(true)
let scrollParent
function onScroll() { pinned.value = scrollParent.scrollHeight - scrollParent.scrollTop - scrollParent.clientHeight < 100 }
function scrollToBottom() { nextTick(() => { if (pinned.value && scrollParent) scrollParent.scrollTop = scrollParent.scrollHeight }) }
watch(messages, scrollToBottom, { deep: true })
onMounted(() => { scrollParent = root.value.closest('.chat-page__scroll'); scrollParent?.addEventListener('scroll', onScroll, { passive: true }); scrollToBottom() })
onBeforeUnmount(() => scrollParent?.removeEventListener('scroll', onScroll))
const rollbackSummary = computed(() => {
  if (!rollbackPreview.value) return '此消息及之后的内容将从对话中回退。'
  return `从这条消息开始的 ${rollbackPreview.value.messages} 条对话会被去掉，你可以在发送新消息前撤销这次回退。`
})
async function requestRollback(message) {
  rollbackTarget.value = message
  rollbackPreview.value = null
  rollbackFiles.value = true
  // 点开就已经能看到代价：多少条消息、哪些文件。等确认时再说太晚了。
  rollbackDialog.value.showModal()
  rollbackPreview.value = await Chat.previewRollback(session.value.id, message.id)
}
async function confirmRollback() { if (await Chat.rollbackMessage(session.value.id, rollbackTarget.value.id, rollbackFiles.value)) rollbackDialog.value?.close() }

// 从这条用户消息分出一个新对话，原对话不动。
async function forkFrom(message) {
  await Session.fork(session.value.id, message.id)
}
const toolLabel = status => ({ waiting: '等待你的许可', running: '正在执行', completed: '已完成', error: '执行失败', rejected: '已拒绝' }[status] || '等待结果')
</script>

<template>
  <div ref="root" class="conversation-flow" aria-label="对话内容">
    <section v-for="message in messages" :key="message.id" class="message" :class="`message--${message.role}`" :aria-label="message.role === 'user' ? '你的消息' : 'la 的回复'">
      <div v-if="message.role === 'user'" class="message__bubble">{{ message.content }}</div>
      <template v-else>
        <details v-if="message.reasoning" class="reasoning"><summary><AppIcon name="spark" :size="14" />思考过程<AppIcon name="down" :size="12" /></summary><p>{{ message.reasoning }}</p></details>
        <div v-if="message.content" class="markdown-body" v-html="renderMarkdown(message.content)"></div>
        <div v-if="message.isStreaming && !message.content" class="typing" role="status"><span></span><span></span><span></span><small>{{ message.retry || '正在思考' }}</small></div>
        <details v-for="tool in message.tools || []" :key="tool.id" class="tool-card" :open="tool.status === 'waiting' || tool.status === 'running'">
          <summary><AppIcon name="code" :size="14" /><strong>{{ tool.name }}</strong><span :class="{ 'tool-warning': tool.status === 'waiting' }">{{ toolLabel(tool.status) }}</span><AppIcon name="down" :size="12" /></summary>
          <div class="tool-card__body"><pre v-if="Object.keys(tool.input || {}).length">{{ JSON.stringify(tool.input, null, 2) }}</pre><pre v-if="tool.preview">{{ tool.preview }}</pre><div v-if="tool.status === 'waiting'" class="approval"><p>此操作需要你的许可。请检查上方工具及参数。</p><div><Button variant="danger" :disabled="tool.deciding" @click="Chat.decide(session.id, tool.id, 'deny')">拒绝</Button><Button :disabled="tool.deciding" @click="Chat.decide(session.id, tool.id, 'always-allow')">始终允许此参数</Button><Button variant="primary" :disabled="tool.deciding" @click="Chat.decide(session.id, tool.id, 'allow-once')">允许一次</Button></div></div></div>
        </details>
        <p v-if="message.error" class="message__error" role="alert"><AppIcon name="info" :size="16" />{{ message.error }}</p>
        <div v-if="message.request?.input || message.request?.output" class="message__usage">输入 {{ message.request.input.toLocaleString() }} <span>·</span>输出 {{ message.request.output.toLocaleString() }} tokens</div>
      </template>
      <div v-if="!message.isStreaming" class="message__actions"><IconButton size="small" label="复制消息" title="复制消息" @click="UI.copy(message.content)"><AppIcon name="copy" :size="14" /></IconButton><IconButton v-if="message.role === 'user' && !message.id.startsWith('pending_')" size="small" label="回退到此消息" title="回退到此消息之前" :disabled="session.status === 'running'" @click="requestRollback(message)"><AppIcon name="undo" :size="14" /></IconButton><IconButton v-if="message.role === 'user' && !message.id.startsWith('pending_')" size="small" label="从这里分支" title="从这条消息分出新的对话" :disabled="session.status === 'running'" @click="forkFrom(message)"><AppIcon name="branch" :size="14" /></IconButton></div>
    </section>
    <dialog ref="rollbackDialog" class="dialog" aria-label="确认回退">
      <h2>回到这条消息之前？</h2>
      <p>{{ rollbackSummary }}</p>
      <label v-if="rollbackPreview?.files?.length" class="rollback-files">
        <span>这一段的改动（{{ rollbackPreview.files.length }} 个文件）</span>
        <ul><li v-for="file in rollbackPreview.files" :key="file.path">{{ file.path }}</li></ul>
      </label>
      <!-- 回退勾选框是专用 checkbox，本阶段保留原生；后续换成 ui 的 checkbox / switch 控件。 -->
      <label class="rollback-choice">
        <input v-model="rollbackFiles" type="checkbox" />
        <span>同时把文件改回原样</span>
      </label>
      <p class="rollback-hint">{{ rollbackFiles ? '文件和对话一起退回这一步之前。' : '只退对话，工作区里的文件保持现在的样子。' }}</p>
      <div class="dialog-actions"><Button @click="rollbackDialog.close()">取消</Button><Button variant="primary" @click="confirmRollback">确认回退</Button></div>
    </dialog>
  </div>
</template>

<style scoped lang="scss">
.conversation-flow { width: 100%; max-width: var(--la-chat-width); margin: 0 auto; padding: 20px 20px 24px; display: flex; flex-direction: column; gap: 24px; }
.message { min-width: 0; }
.message--user { display: flex; flex-direction: column; align-items: flex-end; }
.message__bubble {
  max-width: min(82%, 64ch);
  padding: 8px 12px;
  border: 0;
  border-radius: 10px;
  background: var(--la-layer-02);
  color: var(--la-text);
  font-size: 13px;
  line-height: 20px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.message__actions { display: flex; gap: 1px; margin-top: 4px; opacity: 0; }
.message--user .message__actions { justify-content: flex-end; }
.message:hover .message__actions, .message:focus-within .message__actions { opacity: 1; }
.markdown-body { color: var(--la-text); font-size: 13.5px; line-height: 1.9; overflow-wrap: anywhere; }
.markdown-body :deep(p) { margin: 0 0 12px; }
.markdown-body :deep(h1), .markdown-body :deep(h2), .markdown-body :deep(h3) { line-height: 1.5; font-weight: 530; margin: 20px 0 10px; }
.markdown-body :deep(h1) { font-size: 20px; } .markdown-body :deep(h2) { font-size: 17px; } .markdown-body :deep(h3) { font-size: 15px; }
.markdown-body :deep(pre) { max-width: 100%; overflow-x: auto; border: .5px solid var(--la-line); padding: 12px; border-radius: 8px; background: var(--la-layer-01); color: var(--la-text); line-height: 1.7; }
.markdown-body :deep(code) { font: 12px/1.7 var(--la-font-mono); }
.markdown-body :deep(:not(pre) > code) { padding: 1px 4px; background: var(--la-layer-02); border-radius: 4px; color: var(--la-text); }
.markdown-body :deep(a) { color: var(--la-accent); text-underline-offset: 4px; }
.markdown-body :deep(img) { max-width: 100%; height: auto; border-radius: 8px; }
.markdown-body :deep(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
.markdown-body :deep(td), .markdown-body :deep(th) { padding: 6px 9px; border: .5px solid var(--la-line); }
.markdown-body :deep(blockquote) { margin-left: 0; padding-left: 14px; border-left: 2px solid var(--la-accent-border); color: var(--la-secondary); }
.markdown-body :deep(.katex-display) { overflow-x: auto; overflow-y: hidden; }
.reasoning { padding: 0; margin: 2px 0 8px; border: 0; color: var(--la-muted); font-size: 13px; }
.reasoning summary { display: flex; align-items: center; gap: 6px; cursor: pointer; font-weight: 440; }
.reasoning p { margin: 8px 0 0 20px; white-space: pre-wrap; line-height: 20px; font-size: 13px; }
.typing { display: flex; align-items: center; gap: 4px; height: 28px; color: var(--la-muted); }
.typing > span { width: 4px; height: 4px; background: var(--la-accent); border-radius: 50%; animation: pulse 1.3s infinite alternate; }
.typing > span:nth-child(2) { animation-delay: .2s; } .typing > span:nth-child(3) { animation-delay: .4s; }
.typing small { margin-left: 8px; font-size: 13px; }
@keyframes pulse { to { opacity: .2; transform: translateY(-2px); } }
.tool-card { margin: 2px 0; border: 0; border-radius: 0; background: transparent; overflow: visible; }
.tool-card summary { display: flex; align-items: center; gap: 8px; min-height: 28px; padding: 2px 0; color: var(--la-muted); font-size: 13px; cursor: pointer; }
.tool-card summary strong { color: var(--la-text); font-weight: 530; overflow-wrap: anywhere; }
.tool-card summary > span { margin-left: auto; color: var(--la-muted); white-space: nowrap; font-size: 12px; }
.tool-card summary > span.tool-warning { color: var(--la-warning); }
.tool-card__body { margin: 4px 0 8px 6px; padding: 12px; border-radius: 8px; background: var(--la-layer-01); box-shadow: inset 0 0 0 .5px var(--la-line); }
.tool-card pre { font: 12px/1.75 var(--la-font-mono); max-height: 320px; overflow: auto; margin: 0 0 8px; color: var(--la-secondary); }
.approval { padding: 12px; border-radius: 8px; background: var(--la-layer-02); }
.approval p { margin: 0 0 10px; font-size: 13px; line-height: 20px; color: var(--la-secondary); }
.approval > div { display: flex; flex-wrap: wrap; gap: 8px; }
.approval .button { height: 28px; font-size: 13px; }
.rollback-files { display: grid; gap: 8px; margin: 0 0 18px; }
.rollback-files > span { font-size: 13px; color: var(--la-muted); }
.rollback-files ul { margin: 0; padding: 10px 12px; list-style: none; max-height: 160px; overflow: auto; border-radius: 6px; background: var(--la-layer-02); }
.rollback-files li { font: 12px/1.9 var(--la-font-mono); color: var(--la-secondary); overflow-wrap: anywhere; }
.rollback-choice { display: flex; align-items: center; gap: 9px; font-size: 13px; color: var(--la-text); }
.rollback-choice input { width: 15px; height: 15px; accent-color: var(--la-accent); }
.rollback-hint { margin: 10px 0 0 !important; font-size: 12px !important; color: var(--la-muted) !important; }
.message__error { display: flex; align-items: flex-start; gap: 8px; color: var(--la-danger); font-size: 13px; line-height: 20px; padding: 8px 0; overflow-wrap: anywhere; }
.message__error > svg { flex-shrink: 0; margin-top: 3px; }
.message__usage { margin-top: 6px; color: var(--la-muted); font-size: 12px; }
.message__usage > span { padding: 0 7px; }
@media (max-width: 767px) {
  .conversation-flow { padding: 16px 12px 22px; gap: 20px; }
  .message__bubble { max-width: 90%; }
}
</style>
