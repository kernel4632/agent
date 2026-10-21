<!--
  会话时间线：按顺序显示消息、思考过程、工具调用与审批，以及回退和分支操作。
  只被会话页使用；自己从 store 读当前会话，不需要传 props。
  整个对话流是一列三行布局的列表：图标、文本、右侧操作；不使用卡片容器。
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
import { groupMessageTurns } from './turns.js'
import 'highlight.js/styles/github-dark.css'
import 'katex/dist/katex.min.css'

const root = ref(null)
const session = computed(() => store.sessions[store.ui.activeSessionID])
const messages = computed(() => session.value?.messages || [])
// 一条用户消息和它后面自动接续的所有助手消息算一轮，头像和名字每轮只显示一次。
const turns = computed(() => groupMessageTurns(messages.value))
const turnStreaming = turn => turn.messages.some(message => message.isStreaming)
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

// 一条助手消息的复制/回退只出现一次：优先思考行，其次正文行，只有工具时放在最后一个工具行。
const messageActionKind = message => message.reasoning ? 'thinking' : message.content ? 'text' : message.tools?.length ? 'tool' : 'text'

// 思考流式预览只显示最后一段，并始终滚到最底部，让最新推理内容可见。
const latestReasoning = message => (message.reasoning || '').slice(-600)
const previews = new Map()
function bindPreview(id, element) {
  if (element) previews.set(id, element)
  else previews.delete(id)
}
async function pinPreviews() {
  await nextTick()
  for (const element of previews.values()) element.scrollTop = element.scrollHeight
}
watch(() => messages.value.map(message => message.reasoning?.length || 0).join(','), pinPreviews)
onMounted(pinPreviews)
</script>

<template>
  <div ref="root" class="conversation-flow" aria-label="对话内容">
    <article v-for="turn in turns" :key="turn.id" class="message" :class="`message--${turn.role}`" :aria-label="turn.role === 'user' ? '你的消息' : 'la 的回复'">
      <template v-if="turn.role === 'user'">
        <div class="list-row list-row--user">
          <span class="list-row__icon user-head__avatar" aria-hidden="true">你</span>
          <div class="list-row__main">
            <div class="message__text message__bubble">{{ turn.messages[0].content }}</div>
          </div>
          <div v-if="!turn.messages[0].isStreaming" class="list-row__actions message__actions">
            <IconButton size="small" label="复制消息" title="复制消息" @click="UI.copy(turn.messages[0].content)"><AppIcon name="copy" :size="14" /></IconButton>
            <IconButton v-if="canRollback(turn.messages[0])" size="small" label="回退到这条消息" title="删除这条消息及之后的内容" :disabled="session.status === 'running'" @click="requestRollback(turn.messages[0])"><AppIcon name="undo" :size="14" /></IconButton>
            <IconButton v-if="canRollback(turn.messages[0])" size="small" label="从这里分支" title="从这条消息分出新的对话" :disabled="session.status === 'running'" @click="forkFrom(turn.messages[0])"><AppIcon name="branch" :size="14" /></IconButton>
          </div>
        </div>
      </template>
      <template v-else>
        <div class="list-row list-row--head">
          <span class="list-row__icon assistant-head__avatar" :class="{ 'is-thinking': turnStreaming(turn) }" aria-hidden="true"><AppIcon name="spark" :size="12" /></span>
          <div class="list-row__main assistant-head">
            <span class="assistant-head__name">la</span>
            <span class="assistant-head__model" :title="session.model">{{ session.model }}</span>
          </div>
        </div>
        <div class="assistant-thread">
          <div v-for="message in turn.messages" :key="message.id" class="assistant-message">
            <div class="assistant-message__content">
              <div v-if="message.reasoning" class="list-row list-row--thinking" :class="{ 'is-live': message.isStreaming && !message.content }">
                <span class="list-row__icon"><AppIcon name="spark" :size="14" /></span>
                <div class="list-row__main">
                  <button type="button" class="list-row__toggle" :aria-expanded="rowOpen(reasoningKey(message))" @click="toggleRow(reasoningKey(message))">
                    <span class="list-row__label" :class="{ 'is-live': message.isStreaming && !message.content }">思考过程</span>
                    <span v-if="message.isStreaming && !message.content" class="list-row__status is-running">思考中</span>
                  </button>
                  <div v-if="message.isStreaming && message.reasoning" :ref="element => bindPreview(message.id, element)" class="thinking-preview">
                    <span class="thinking-preview__text">{{ latestReasoning(message) }}</span><span class="thinking-preview__caret" aria-hidden="true">▍</span>
                  </div>
                  <div class="flow-content" :class="{ 'is-open': rowOpen(reasoningKey(message)) }">
                    <div class="flow-content__inner"><div class="flow-content__body"><p class="reasoning-text">{{ message.reasoning }}</p></div></div>
                  </div>
                </div>
                <div class="list-row__actions message__actions">
                  <template v-if="!message.isStreaming && messageActionKind(message) === 'thinking'">
                    <IconButton size="small" label="复制消息" title="复制消息" @click="UI.copy(message.content)"><AppIcon name="copy" :size="14" /></IconButton>
                    <IconButton v-if="canRollback(message)" size="small" label="回退到这条回复" title="删除这条消息及之后的内容" :disabled="session.status === 'running'" @click="requestRollback(message)"><AppIcon name="undo" :size="14" /></IconButton>
                  </template>
                  <IconButton class="row-chevron" size="small" :label="rowOpen(reasoningKey(message)) ? '收起思考过程' : '展开思考过程'" :aria-expanded="rowOpen(reasoningKey(message))" @click="toggleRow(reasoningKey(message))"><AppIcon name="down" :size="14" /></IconButton>
                </div>
              </div>
              <div v-for="(tool, index) in message.tools || []" :key="tool.id" class="list-row list-row--tool" :class="{ 'is-live': tool.status === 'running' }">
                <span class="list-row__icon"><AppIcon name="code" :size="14" /></span>
                <div class="list-row__main">
                  <button type="button" class="list-row__toggle tool-toggle" :aria-expanded="rowOpen(toolKey(message, tool), toolDefaultOpen(tool))" @click="toggleRow(toolKey(message, tool), toolDefaultOpen(tool))">
                    <span class="list-row__label" :class="{ 'is-live': tool.status === 'running' }">{{ tool.name }}</span>
                    <span class="list-row__status" :class="toolStatusClass(tool.status)">{{ toolLabel(tool.status) }}</span>
                  </button>
                  <div class="flow-content" :class="{ 'is-open': rowOpen(toolKey(message, tool), toolDefaultOpen(tool)) }">
                    <div class="flow-content__inner">
                      <div class="flow-content__body tool-body">
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
                <div class="list-row__actions message__actions">
                  <template v-if="!message.isStreaming && messageActionKind(message) === 'tool' && index === (message.tools || []).length - 1">
                    <IconButton size="small" label="复制消息" title="复制消息" @click="UI.copy(message.content)"><AppIcon name="copy" :size="14" /></IconButton>
                    <IconButton v-if="canRollback(message)" size="small" label="回退到这条回复" title="删除这条消息及之后的内容" :disabled="session.status === 'running'" @click="requestRollback(message)"><AppIcon name="undo" :size="14" /></IconButton>
                  </template>
                  <IconButton class="row-chevron" size="small" :label="rowOpen(toolKey(message, tool), toolDefaultOpen(tool)) ? '收起工具详情' : '展开工具详情'" :aria-expanded="rowOpen(toolKey(message, tool), toolDefaultOpen(tool))" @click="toggleRow(toolKey(message, tool), toolDefaultOpen(tool))"><AppIcon name="down" :size="14" /></IconButton>
                </div>
              </div>
              <div v-if="message.content" class="list-row list-row--text">
                <span class="list-row__icon"><AppIcon name="document" :size="14" /></span>
                <div class="list-row__main markdown-body" v-html="renderMarkdown(message.content)"></div>
                <div v-if="!message.isStreaming && messageActionKind(message) === 'text'" class="list-row__actions message__actions">
                  <IconButton size="small" label="复制消息" title="复制消息" @click="UI.copy(message.content)"><AppIcon name="copy" :size="14" /></IconButton>
                  <IconButton v-if="canRollback(message)" size="small" label="回退到这条回复" title="删除这条消息及之后的内容" :disabled="session.status === 'running'" @click="requestRollback(message)"><AppIcon name="undo" :size="14" /></IconButton>
                </div>
              </div>
              <div v-if="message.isStreaming && !message.content" class="list-row list-row--progress">
                <span class="list-row__icon"><AppIcon name="spark" :size="14" /></span>
                <div class="list-row__main typing" role="status"><span></span><span></span><span></span><small>{{ message.retry || '正在思考' }}</small></div>
              </div>
              <div v-if="message.error" class="list-row list-row--error">
                <span class="list-row__icon"><AppIcon name="info" :size="14" /></span>
                <div class="list-row__main"><p class="message__error" role="alert">{{ message.error }}</p></div>
              </div>
              <div v-if="message.request?.input || message.request?.output" class="list-row list-row--usage">
                <span class="list-row__icon"><AppIcon name="clock" :size="13" /></span>
                <div class="list-row__main"><div class="message__usage">输入 {{ message.request.input.toLocaleString() }} <span>·</span>输出 {{ message.request.output.toLocaleString() }} tokens</div></div>
              </div>
            </div>
          </div>
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
.conversation-flow { width: 100%; max-width: var(--la-chat-width); margin: 0 auto; padding: 8px 20px 18px; display: flex; flex-direction: column; gap: 12px; }
.message { display: block; min-width: 0; animation: row-in .18s ease-out both; }
@keyframes row-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

/* 所有条目共用三列：图标、文本、右侧操作。行间只靠 padding 分隔。 */
.list-row {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  align-items: start;
  gap: 8px;
  min-width: 0;
  padding: 3px 4px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  animation: row-fade .18s ease-out both;
}
@keyframes row-fade { from { opacity: 0; } to { opacity: 1; } }
.list-row__icon { display: flex; align-items: center; justify-content: center; width: 20px; min-height: 20px; margin-top: 1px; color: var(--la-muted); transition: color .16s ease; }
.list-row__main { min-width: 0; }
.list-row__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 1px;
  min-height: 20px;
  opacity: 0;
  transform: translateX(4px);
  transition: opacity .16s ease, transform .16s ease;
}
.message:hover .list-row__actions,
.list-row:focus-within .list-row__actions { opacity: 1; transform: none; }
.message__actions { flex: 0 0 auto; }

/* 用户消息：同一列表结构，只在悬停时轻微高亮，没有气泡卡片。 */
.list-row--user { transition: background .16s ease; }
.list-row--user:hover { background: var(--la-hover); }
.user-head__avatar {
  display: grid;
  place-items: center;
  height: 20px;
  border-radius: 50%;
  background: var(--la-accent-soft);
  color: var(--md-sys-color-on-primary-container, var(--la-text));
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
}
.message__text { width: auto; color: var(--la-text); font-size: 13.5px; line-height: 20px; white-space: pre-wrap; overflow-wrap: anywhere; }
.message__bubble { padding: 0; border: 0; border-radius: 0; background: transparent; color: inherit; }

/* 助手标题行：头像、名字、模型每轮只出现一次。 */
.list-row--head { padding-top: 2px; padding-bottom: 2px; }
.assistant-head { display: flex; align-items: baseline; gap: 6px; min-height: 20px; }
.assistant-head__avatar {
  display: grid;
  place-items: center;
  height: 20px;
  border-radius: 50%;
  background: var(--la-layer-02);
  color: var(--la-accent);
  box-shadow: inset 0 0 0 .5px var(--la-line);
}
.assistant-head__avatar.is-thinking { animation: avatar-breathe 2.2s ease-in-out infinite; }
@keyframes avatar-breathe { 50% { opacity: .78; transform: scale(1.05); } }
.assistant-head__name { flex: 0 0 auto; color: var(--la-text); font-size: 13px; font-weight: 600; }
.assistant-head__model { min-width: 0; overflow: hidden; color: var(--la-muted); font: 12px/1.4 var(--la-font-mono); text-overflow: ellipsis; white-space: nowrap; }
/* 一轮助手发言内部不额外留白，轮次之间由 conversation-flow 的 12px 控制。 */
.assistant-thread { display: flex; flex-direction: column; min-width: 0; }
.assistant-message { display: block; min-width: 0; }
.assistant-message__content { display: flex; flex-direction: column; min-width: 0; }

/* 思考行和工具行的标题按钮：只占文本列，图标和右侧操作单独成列。 */
.list-row__toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  min-height: 20px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--la-secondary);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.list-row__toggle:hover { color: var(--la-text); }
.list-row__toggle:focus-visible { outline: 2px solid var(--la-accent-border); outline-offset: 1px; }
.list-row__label { min-width: 0; overflow: hidden; color: var(--la-text); font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
/* 流式时标签扫过一道柔光。 */
.list-row__label.is-live {
  background-image: linear-gradient(90deg, var(--la-muted) 10%, var(--la-text) 46%, var(--la-muted) 82%);
  background-size: 220% 100%;
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  animation: label-shimmer 1.6s linear infinite;
}
@keyframes label-shimmer { from { background-position: 130% 0; } to { background-position: -130% 0; } }
.list-row__status { flex: 0 0 auto; color: var(--la-muted); font-size: 11.5px; white-space: nowrap; }
.list-row__status.is-waiting { color: var(--la-warning); animation: soft-pulse 1.8s ease-in-out infinite; }
.list-row__status.is-running { color: var(--la-accent); animation: soft-pulse 1.8s ease-in-out infinite; }
.list-row__status.is-completed { color: var(--la-success); }
.list-row__status.is-error, .list-row__status.is-rejected { color: var(--la-danger); }
.tool-toggle .list-row__status { margin-left: auto; }
@keyframes soft-pulse { 50% { opacity: .5; } }
.list-row--thinking.is-live .list-row__icon, .list-row--tool.is-live .list-row__icon { color: var(--la-accent); }
.row-chevron { flex: 0 0 auto; color: var(--la-muted); transition: transform .18s ease, color .16s ease; }
.row-chevron[aria-expanded="true"] { transform: rotate(180deg); }

/* 思考流式预览：只显示最后一段，上下渐隐，并带闪烁光标。 */
.thinking-preview {
  position: relative;
  max-height: 72px;
  overflow: hidden;
  margin: 2px 0 0;
  padding: 4px 0 2px;
  color: var(--la-secondary);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  -webkit-mask-image: linear-gradient(transparent, #000 18%, #000 82%, transparent);
  mask-image: linear-gradient(transparent, #000 18%, #000 82%, transparent);
  animation: preview-in .2s ease-out both;
}
.thinking-preview__text { white-space: pre-wrap; }
.thinking-preview__caret { margin-left: 1px; color: var(--la-accent); text-shadow: 0 0 10px var(--la-accent-border); animation: caret-blink 1.06s steps(1, end) infinite; }
@keyframes preview-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes caret-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: .15; } }

/* 0fr -> 1fr 的高度过渡，收起时完全不占位；内容在文本列下方展开。 */
.flow-content { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .2s ease; }
.flow-content.is-open { grid-template-rows: 1fr; }
.flow-content__inner { min-height: 0; overflow: hidden; }
.flow-content__body { min-width: 0; padding: 2px 0 8px; }
.reasoning-text { margin: 0; color: var(--la-secondary); font-size: 12.5px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
.tool-body { display: grid; gap: 6px; min-width: 0; }
.tool-body pre {
  max-width: 100%;
  max-height: 240px;
  overflow: auto;
  margin: 0;
  padding: 4px 0 4px 8px;
  border: 0;
  border-left: 2px solid var(--la-line);
  border-radius: 0;
  background: transparent;
  color: var(--la-secondary);
  font: 12px/1.7 var(--la-font-mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.approval { display: grid; gap: 8px; padding: 4px 0 2px; }
.approval p { margin: 0; color: var(--la-secondary); font-size: 12.5px; line-height: 18px; }
.approval > div { display: flex; flex-wrap: wrap; gap: 6px; }
.approval .button { height: 26px; padding: 0 10px; font-size: 12px; }

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

/* 等待回复的进度行、错误行和 token 行也保持同样的列表结构。 */
.typing { display: flex; align-items: center; gap: 4px; min-height: 20px; color: var(--la-muted); }
.typing > span { width: 4px; height: 4px; background: var(--la-accent); border-radius: 50%; animation: pulse 1.3s infinite alternate; }
.typing > span:nth-child(2) { animation-delay: .2s; } .typing > span:nth-child(3) { animation-delay: .4s; }
.typing small { margin-left: 8px; font-size: 13px; }
@keyframes pulse { to { opacity: .2; transform: translateY(-2px); } }

.message__error { margin: 0; color: var(--la-danger); font-size: 12.5px; line-height: 18px; overflow-wrap: anywhere; }
.list-row--error .list-row__icon { color: var(--la-danger); }
.message__usage { margin: 0; color: var(--la-muted); font-size: 11.5px; line-height: 18px; }
.message__usage > span { padding: 0 6px; }

.rollback-files { display: grid; gap: 8px; margin: 0 0 16px; }
.rollback-files > span { font-size: 13px; color: var(--la-muted); }
.rollback-files ul { margin: 0; padding: 10px 12px; list-style: none; max-height: 160px; overflow: auto; border-radius: 6px; background: var(--la-layer-02); }
.rollback-files li { font: 12px/1.9 var(--la-font-mono); color: var(--la-secondary); overflow-wrap: anywhere; }
.rollback-choice { display: flex; align-items: center; gap: 9px; font-size: 13px; color: var(--la-text); }
.rollback-choice input { width: 15px; height: 15px; accent-color: var(--la-accent); }
.rollback-hint { margin: 10px 0 0 !important; font-size: 12px !important; color: var(--la-muted) !important; }

@media (max-width: 767px) {
  .conversation-flow { padding: 8px 12px 18px; gap: 12px; }
  .list-row { gap: 7px; padding: 3px 2px; }
  .list-row__actions { opacity: 1; transform: none; }
  .approval .button { height: 28px; }
}
@media (hover: none) {
  .list-row__actions { opacity: 1; transform: none; }
}
</style>
