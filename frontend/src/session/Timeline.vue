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
onMounted(() => { scrollParent = root.value?.closest('.session-scroll'); scrollParent?.addEventListener('scroll', onScroll, { passive: true }); scrollToBottom() })
onBeforeUnmount(() => scrollParent?.removeEventListener('scroll', onScroll))
const rollbackSummary = computed(() => {
  if (!rollbackPreview.value) return '此消息及之后的内容将从对话中回退。'
  return `从这条消息开始的 ${rollbackPreview.value.messages} 条对话会被去掉，你可以在发送新消息前撤销这次回退。`
})
// 只回退后端存过的消息；pending 和本地错误消息没有可用的 messageId。
const canRollback = message => Boolean(message.id) && !message.id.startsWith('pending_') && !message.id.startsWith('error_')
async function requestRollback(message) {
  if (!canRollback(message) || session.value?.status === 'running') return
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

// 展开状态按行 key 记住。没点过时按默认值算：思考收起，工具等待/执行中展开。
const expanded = ref({})
const reasoningKey = message => `reasoning:${message.id}`
const toolKey = (message, tool) => `tool:${message.id}:${tool.id}`
const rowOpen = (key, fallback = false) => expanded.value[key] ?? fallback
const toggleRow = (key, fallback = false) => { expanded.value[key] = !rowOpen(key, fallback) }
const toolDefaultOpen = tool => tool.status === 'waiting' || tool.status === 'running'
const toolStatusClass = status => `is-${status || 'waiting'}`
</script>

<template>
  <div ref="root" class="conversation-flow" aria-label="对话内容">
    <article v-for="message in messages" :key="message.id" class="message" :class="`message--${message.role}`" :aria-label="message.role === 'user' ? '你的消息' : 'la 的回复'">
      <div v-if="message.role === 'user'" class="message__block">
        <div class="message__text message__bubble">{{ message.content }}</div>
        <div v-if="!message.isStreaming" class="message__actions">
          <IconButton size="small" label="复制消息" title="复制消息" @click="UI.copy(message.content)"><AppIcon name="copy" :size="14" /></IconButton>
          <IconButton v-if="canRollback(message)" size="small" label="回退到这条消息" title="删除这条消息及之后的内容" :disabled="session.status === 'running'" @click="requestRollback(message)"><AppIcon name="undo" :size="14" /></IconButton>
          <IconButton v-if="canRollback(message)" size="small" label="从这里分支" title="从这条消息分出新的对话" :disabled="session.status === 'running'" @click="forkFrom(message)"><AppIcon name="branch" :size="14" /></IconButton>
        </div>
      </div>
      <template v-else>
        <header class="assistant-head">
          <span class="assistant-head__avatar" :class="{ 'is-thinking': message.isStreaming }" aria-hidden="true"><AppIcon name="spark" :size="15" /></span>
          <span class="assistant-head__name">la</span>
          <span class="assistant-head__model" :title="session.model">{{ session.model }}</span>
          <div v-if="!message.isStreaming" class="message__actions">
            <IconButton size="small" label="复制消息" title="复制消息" @click="UI.copy(message.content)"><AppIcon name="copy" :size="14" /></IconButton>
            <IconButton v-if="canRollback(message)" size="small" label="回退到这条回复" title="删除这条消息及之后的内容" :disabled="session.status === 'running'" @click="requestRollback(message)"><AppIcon name="undo" :size="14" /></IconButton>
          </div>
        </header>
        <div class="message__body">
          <div v-if="message.reasoning || message.tools?.length" class="thinking-card">
            <div v-if="message.reasoning" class="flow-item reasoning" :class="{ 'is-live': message.isStreaming && !message.content }">
              <button type="button" class="flow-row" :aria-expanded="rowOpen(reasoningKey(message))" @click="toggleRow(reasoningKey(message))">
                <AppIcon name="spark" :size="16" class="flow-row__icon" />
                <span class="flow-row__label" :class="{ 'is-live': message.isStreaming && !message.content }">思考过程</span>
                <span v-if="message.isStreaming && !message.content" class="flow-row__status status--running">思考中</span>
                <AppIcon name="down" :size="14" class="flow-row__chevron" />
              </button>
              <div class="flow-content" :class="{ 'is-open': rowOpen(reasoningKey(message)) }">
                <div class="flow-content__inner"><div class="flow-content__body"><p class="reasoning-text">{{ message.reasoning }}</p></div></div>
              </div>
            </div>
            <div v-for="tool in message.tools || []" :key="tool.id" class="flow-item tool-card" :class="{ 'is-live': tool.status === 'running' }">
              <button type="button" class="flow-row" :aria-expanded="rowOpen(toolKey(message, tool), toolDefaultOpen(tool))" @click="toggleRow(toolKey(message, tool), toolDefaultOpen(tool))">
                <AppIcon name="code" :size="16" class="flow-row__icon" />
                <span class="flow-row__label" :class="{ 'is-live': tool.status === 'running' }">{{ tool.name }}</span>
                <span class="flow-row__status" :class="toolStatusClass(tool.status)">{{ toolLabel(tool.status) }}</span>
                <AppIcon name="down" :size="14" class="flow-row__chevron" />
              </button>
              <div class="flow-content" :class="{ 'is-open': rowOpen(toolKey(message, tool), toolDefaultOpen(tool)) }">
                <div class="flow-content__inner">
                  <div class="flow-content__body tool-card__body">
                    <pre v-if="Object.keys(tool.input || {}).length">{{ JSON.stringify(tool.input, null, 2) }}</pre>
                    <pre v-if="tool.preview">{{ tool.preview }}</pre>
                    <div v-if="tool.status === 'waiting'" class="approval" @click.stop>
                      <p>此操作需要你的许可。请检查上方工具及参数。</p>
                      <div>
                        <Button variant="danger" :disabled="tool.deciding" @click="Chat.decide(session.id, tool.id, 'deny')">拒绝</Button>
                        <Button :disabled="tool.deciding" @click="Chat.decide(session.id, tool.id, 'always-allow')">始终允许此参数</Button>
                        <Button variant="primary" :disabled="tool.deciding" @click="Chat.decide(session.id, tool.id, 'allow-once')">允许一次</Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-if="message.content" class="assistant-text-row markdown-body" v-html="renderMarkdown(message.content)"></div>
          <div v-if="message.isStreaming && !message.content" class="typing" role="status"><span></span><span></span><span></span><small>{{ message.retry || '正在思考' }}</small></div>
          <p v-if="message.error" class="message__error" role="alert"><AppIcon name="info" :size="16" />{{ message.error }}</p>
          <div v-if="message.request?.input || message.request?.output" class="message__usage">输入 {{ message.request.input.toLocaleString() }} <span>·</span>输出 {{ message.request.output.toLocaleString() }} tokens</div>
        </div>
      </template>
    </article>
    <dialog ref="rollbackDialog" class="dialog" aria-label="确认回退">
      <h2>{{ rollbackTarget?.role === 'assistant' ? '回到这条回复之前？' : '回到这条消息之前？' }}</h2>
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
.conversation-flow { width: 100%; max-width: var(--la-chat-width); margin: 0 auto; padding: 10px 20px 18px; display: flex; flex-direction: column; gap: 4px; }
.message { display: block; min-width: 0; animation: row-in .18s ease-out both; }
@keyframes row-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

/* 用户消息：正文和操作在同一行。 */
.message__block {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  min-width: 0;
  padding: 7px 8px 7px 12px;
  border: .5px solid var(--la-line);
  border-radius: 12px;
  background: var(--la-layer-02);
}
.message__text {
  width: 100%;
  color: var(--la-text);
  font-size: 13.5px;
  line-height: 20px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.message--user .message__bubble { width: auto; min-width: 0; flex: 1; }

/* 助手标题行：头像、名字、模型和操作共用一排。 */
.assistant-head { display: flex; align-items: center; gap: 6px; min-height: 28px; min-width: 0; }
.assistant-head__avatar {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  border-radius: 50%;
  background: var(--la-layer-02);
  color: var(--la-accent);
  box-shadow: inset 0 0 0 .5px var(--la-line);
}
.assistant-head__avatar.is-thinking { animation: avatar-breathe 2.2s ease-in-out infinite; }
@keyframes avatar-breathe { 50% { opacity: .78; transform: scale(1.05); } }
.assistant-head__name { flex: 0 0 auto; color: var(--la-text); font-size: 13px; font-weight: 600; }
.assistant-head__model { min-width: 0; overflow: hidden; color: var(--la-muted); font: 12px/1.4 var(--la-font-mono); text-overflow: ellipsis; white-space: nowrap; }
.message__body { display: flex; flex-direction: column; gap: 4px; min-width: 0; }

/* 操作行：桌面低透明度，悬停或聚焦时清晰；手机常显。 */
.message__actions {
  display: flex;
  align-items: center;
  gap: 1px;
  flex: 0 0 auto;
  margin-left: auto;
  opacity: .32;
  transform: translateX(4px);
  transition: opacity .16s ease, transform .16s ease;
}
.message--user .message__actions { margin-top: 1px; }
.message:hover .message__actions,
.message:focus-within .message__actions { opacity: 1; transform: none; }

/* 助手正文直接铺开，不加背景块。 */
.markdown-body { min-width: 0; color: var(--la-text); font-size: 13.5px; line-height: 1.8; overflow-wrap: anywhere; }
.markdown-body :deep(p) { margin: 0 0 10px; }
.markdown-body :deep(p:last-child) { margin-bottom: 0; }
.markdown-body :deep(h1), .markdown-body :deep(h2), .markdown-body :deep(h3) { line-height: 1.5; font-weight: 530; margin: 16px 0 8px; }
.markdown-body :deep(h1) { font-size: 20px; } .markdown-body :deep(h2) { font-size: 17px; } .markdown-body :deep(h3) { font-size: 15px; }
.markdown-body :deep(pre) { max-width: 100%; overflow-x: auto; margin: 0 0 10px; border: .5px solid var(--la-line); padding: 10px 12px; border-radius: 8px; background: var(--la-layer-01); color: var(--la-text); line-height: 1.7; }
.markdown-body :deep(code) { font: 12px/1.7 var(--la-font-mono); }
.markdown-body :deep(:not(pre) > code) { padding: 1px 4px; background: var(--la-layer-02); border-radius: 4px; color: var(--la-text); }
.markdown-body :deep(a) { color: var(--la-accent); text-underline-offset: 4px; }
.markdown-body :deep(img) { max-width: 100%; height: auto; border-radius: 8px; }
.markdown-body :deep(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
.markdown-body :deep(td), .markdown-body :deep(th) { padding: 6px 9px; border: .5px solid var(--la-line); }
.markdown-body :deep(blockquote) { margin-left: 0; padding-left: 14px; border-left: 2px solid var(--la-accent-border); color: var(--la-secondary); }
.markdown-body :deep(.katex-display) { overflow-x: auto; overflow-y: hidden; }

/* 思考和工具共用一个紧凑卡片，行间只有分隔线。 */
.thinking-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  max-width: 100%;
  padding: 2px 10px;
  border-radius: 16px;
  background: var(--la-layer-01);
  box-shadow: inset 0 0 0 .5px var(--la-line);
}
.flow-item { min-width: 0; animation: flow-in .17s ease-out both; }
.flow-item + .flow-item { border-top: .5px solid var(--la-line); }
@keyframes flow-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
.flow-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 30px;
  min-width: 0;
  padding: 2px 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--la-secondary);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.flow-row:hover { color: var(--la-text); }
.flow-row:focus-visible { outline: 2px solid var(--la-accent-border); outline-offset: -2px; }
.flow-row__icon { flex: 0 0 16px; color: var(--la-muted); transition: color .16s ease; }
.flow-item.is-live .flow-row__icon { color: var(--la-accent); }
.flow-row__label { min-width: 0; overflow: hidden; color: var(--la-text); font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
/* 流式时标签扫过一道柔光。 */
.flow-row__label.is-live {
  background-image: linear-gradient(90deg, var(--la-muted) 10%, var(--la-text) 46%, var(--la-muted) 82%);
  background-size: 220% 100%;
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  animation: label-shimmer 1.6s linear infinite;
}
@keyframes label-shimmer { from { background-position: 130% 0; } to { background-position: -130% 0; } }
.flow-row__status { margin-left: auto; flex: 0 0 auto; color: var(--la-muted); font-size: 11.5px; white-space: nowrap; }
.flow-row__status.is-waiting { color: var(--la-warning); animation: soft-pulse 1.8s ease-in-out infinite; }
.flow-row__status.is-running, .flow-row__status.status--running { color: var(--la-accent); animation: soft-pulse 1.8s ease-in-out infinite; }
.flow-row__status.is-completed { color: var(--la-success); }
.flow-row__status.is-error, .flow-row__status.is-rejected { color: var(--la-danger); }
@keyframes soft-pulse { 50% { opacity: .5; } }
.flow-row__chevron { flex: 0 0 auto; color: var(--la-muted); transition: transform .18s ease, color .16s ease; }
.flow-row:hover .flow-row__chevron { color: var(--la-text); transform: rotate(180deg); }
.flow-row[aria-expanded="true"] .flow-row__chevron { transform: rotate(180deg); }

/* 0fr -> 1fr 的高度过渡，收起时完全不占位。 */
.flow-content { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .2s ease; }
.flow-content.is-open { grid-template-rows: 1fr; }
.flow-content__inner { min-height: 0; overflow: hidden; }
.flow-content__body { min-width: 0; padding: 0 0 8px 24px; }
.reasoning-text { margin: 0; color: var(--la-secondary); font-size: 12.5px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
.tool-card__body { display: grid; gap: 6px; min-width: 0; }
.tool-card__body pre {
  max-width: 100%;
  max-height: 240px;
  overflow: auto;
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--la-layer-02);
  color: var(--la-secondary);
  font: 12px/1.7 var(--la-font-mono);
}
.approval { padding: 8px 10px; border-radius: 10px; background: var(--la-layer-02); }
.approval p { margin: 0 0 8px; color: var(--la-secondary); font-size: 12.5px; line-height: 18px; }
.approval > div { display: flex; flex-wrap: wrap; gap: 6px; }
.approval .button { height: 26px; padding: 0 10px; font-size: 12px; }

.typing { display: flex; align-items: center; gap: 4px; height: 24px; color: var(--la-muted); }
.typing > span { width: 4px; height: 4px; background: var(--la-accent); border-radius: 50%; animation: pulse 1.3s infinite alternate; }
.typing > span:nth-child(2) { animation-delay: .2s; } .typing > span:nth-child(3) { animation-delay: .4s; }
.typing small { margin-left: 8px; font-size: 13px; }
@keyframes pulse { to { opacity: .2; transform: translateY(-2px); } }

.message__error { display: flex; align-items: flex-start; gap: 6px; margin: 0; padding: 2px 0; color: var(--la-danger); font-size: 12.5px; line-height: 18px; overflow-wrap: anywhere; }
.message__error > svg { flex-shrink: 0; margin-top: 2px; }
.message__usage { margin: 0; color: var(--la-muted); font-size: 11.5px; }
.message__usage > span { padding: 0 6px; }

.rollback-files { display: grid; gap: 8px; margin: 0 0 16px; }
.rollback-files > span { font-size: 13px; color: var(--la-muted); }
.rollback-files ul { margin: 0; padding: 10px 12px; list-style: none; max-height: 160px; overflow: auto; border-radius: 6px; background: var(--la-layer-02); }
.rollback-files li { font: 12px/1.9 var(--la-font-mono); color: var(--la-secondary); overflow-wrap: anywhere; }
.rollback-choice { display: flex; align-items: center; gap: 9px; font-size: 13px; color: var(--la-text); }
.rollback-choice input { width: 15px; height: 15px; accent-color: var(--la-accent); }
.rollback-hint { margin: 10px 0 0 !important; font-size: 12px !important; color: var(--la-muted) !important; }

@media (max-width: 767px) {
  .conversation-flow { padding: 10px 12px 18px; gap: 4px; }
  .message__actions { opacity: 1; transform: none; }
  .message__block { padding: 7px 6px 7px 10px; }
  .message__text { max-width: 100%; }
  .thinking-card { padding: 2px 8px; border-radius: 14px; }
  .flow-content__body { padding-left: 22px; }
  .approval .button { height: 28px; }
}
@media (hover: none) {
  .message__actions { opacity: 1; transform: none; }
}
</style>
