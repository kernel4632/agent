<!--
  会话时间线：按顺序显示消息、思考过程、工具调用与审批，以及回退和分支操作。
  只被会话页使用；会话从 store 读，滚动容器必须由调用方传入。
  整个对话流是一列三行布局的列表：图标、文本、右侧操作；不使用卡片容器。
  按钮和图标按钮走 ui/；回退弹窗独立为 RollbackDialog，时间线只负责发起和确认。
  调用示例：
  <Timeline :key="session.id" :scroll-root="conversationScroll" />
-->
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { store } from '../store.js'
import { Chat } from './chat.js'
import { Session } from './session.js'
import { UI } from '../app/ui.js'
import { groupMessageTurns } from './turns.js'
import { isSavedMessage } from './continue.js'
import { AppIcon, KimaMarkdown } from '../ui/index.js'
import MessageActionTarget from './MessageActionTarget.vue'
import CompactionNotice from './CompactionNotice.vue'
import './conversation.scss'
import AssistantTurn from './AssistantTurn.vue'
import RollbackDialog from './RollbackDialog.vue'
import 'highlight.js/styles/github-dark.css'
import 'katex/dist/katex.min.css'

const props = defineProps({
    // 滚动容器由页面显式传入，不在组件里靠 class 查找祖先。
    scrollRoot: { type: Object, default: null },
})
const session = computed(() => store.sessions[store.ui.activeSessionID])
const messages = computed(() => session.value?.messages || [])
// 一条用户消息和它后面自动接续的所有助手消息算一轮，头像和名字每轮只显示一次。
const turns = computed(() => groupMessageTurns(messages.value))
// 切换会话时只挂最近几轮，避免一下子渲染几百条历史；滚到顶部再按需加载更早的。
const INITIAL_TURNS = 5
const LOAD_STEP = 5
function firstUserAtOrAfter(start) {
  const index = turns.value.slice(start).findIndex(turn => turn.role === 'user')
  return index < 0 ? start : start + index
}
// 短会话从头显示，不能因为首条是助手消息就把带审批的那一轮藏起来。
function visibleStartFor(start) {
  return start <= 0 ? 0 : firstUserAtOrAfter(start)
}
const visibleStart = ref(visibleStartFor(Math.max(0, turns.value.length - INITIAL_TURNS)))
const visibleTurns = computed(() => turns.value.slice(visibleStart.value))
const earlierCount = computed(() => visibleStart.value)
let loadingEarlier = false
function loadEarlier() {
  if (loadingEarlier || !earlierCount.value || !scrollParent) return
  loadingEarlier = true
  const beforeHeight = scrollParent.scrollHeight
  const beforeTop = scrollParent.scrollTop
  const target = Math.max(0, visibleStart.value - LOAD_STEP)
  visibleStart.value = visibleStartFor(target)
  // 旧内容插到上面后，把滚动位置往下补同样的高度，用户不会突然跳走。
  nextTick(() => {
    scrollParent.scrollTop = beforeTop + (scrollParent.scrollHeight - beforeHeight)
    loadingEarlier = false
  })
}
watch(() => turns.value.length, length => {
  if (visibleStart.value > length) visibleStart.value = visibleStartFor(Math.max(0, length - INITIAL_TURNS))
})
const pinned = ref(true)
const rollbackTarget = ref(null)
const rollbackDialog = ref(null)
const rollbackPreview = ref(null)
const flow = ref(null)
const topSentinel = ref(null)
let scrollParent
let observer
let sentinelObserver
let frame = 0
let lastTop = 0
// 离底部 100px 内都算“在看最新内容”；往上滚时立刻解除跟随，避免被自动滚动拽回去。
function onScroll() {
  const top = scrollParent.scrollTop
  const distance = scrollParent.scrollHeight - top - scrollParent.clientHeight
  if (top < lastTop - 1) pinned.value = false
  else pinned.value = distance < 100
  lastTop = top
  if (pinned.value) scheduleScroll()
}
// 滚动和流式输出都可能在一帧内触发很多次；合并到下一帧，只量一次高度、只改一次 scrollTop。
function scheduleScroll() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    if (pinned.value && scrollParent) scrollParent.scrollTop = scrollParent.scrollHeight
  })
}
function jumpToBottom() {
  pinned.value = true
  if (scrollParent) scrollParent.scrollTop = scrollParent.scrollHeight
}
watch(() => turns.value.length, scheduleScroll)
onMounted(() => {
  scrollParent = props.scrollRoot
  scrollParent?.addEventListener('scroll', onScroll, { passive: true })
  // 监听内容高度，而不是深度监听整段消息：流式追加文字、图片加载、工具展开都会改变高度。
  observer = new ResizeObserver(scheduleScroll)
  if (flow.value) observer.observe(flow.value)
  // 滚到最上面时自动接上一页历史；按钮仍然保留，键盘和读屏也能主动加载。
  sentinelObserver = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) loadEarlier()
  }, { root: scrollParent, rootMargin: '120px 0px 0px 0px' })
  if (topSentinel.value) sentinelObserver.observe(topSentinel.value)
  scheduleScroll()
})
onBeforeUnmount(() => {
  scrollParent?.removeEventListener('scroll', onScroll)
  observer?.disconnect()
  sentinelObserver?.disconnect()
  if (frame) cancelAnimationFrame(frame)
})
// 只回退后端存过的消息；pending 和本地错误消息没有可用的 messageId。
const canRollback = message => isSavedMessage(message)

async function requestRollback(message) {
  if (!canRollback(message) || session.value?.status === 'running') return
  rollbackTarget.value = message
  rollbackPreview.value = null
  // 点开就已经能看到代价：多少条消息、哪些文件。等确认时再说太晚了。
  rollbackDialog.value?.show()
  rollbackPreview.value = await Chat.previewRollback(session.value.id, message.id)
}
async function confirmRollback(restoreFiles) {
  if (await Chat.rollbackMessage(session.value.id, rollbackTarget.value.id, restoreFiles)) rollbackDialog.value?.close()
}

// 从这条用户消息分出一个新对话，原对话不动。
async function forkFrom(message) {
  await Session.fork(session.value.id, message.id)
}

function userMenuItems(message) {
  const items = [{ value: 'copy', label: '复制消息', icon: 'copy' }]
  if (canRollback(message)) {
    items.push({ value: 'rollback', label: '回退到这条消息', icon: 'undo' })
    items.push({ value: 'fork', label: '从这里分支', icon: 'branch' })
  }
  return items
}

function onUserMenu(message, action) {
  if (action === 'copy') UI.copy(message.displayContent ?? message.content)
  else if (action === 'rollback') requestRollback(message)
  else if (action === 'fork') forkFrom(message)
}

// 继续入口已经合并到输入框的发送按钮。
</script>

<template>
  <div ref="flow" class="conversation-flow" role="log" aria-label="对话内容">
    <span ref="topSentinel" class="conversation-top-sentinel" aria-hidden="true"></span>
    <button v-if="earlierCount" type="button" class="conversation-earlier" @click="loadEarlier">
      <AppIcon name="up" :size="14" />
      更早的 {{ earlierCount }} 轮
    </button>
    <article v-for="turn in visibleTurns" :key="turn.id" class="message" :class="[`message--${turn.role}`, { 'message--compact': turn.messages[0].compact }]" :aria-label="turn.messages[0].compact ? '上下文压缩' : turn.role === 'user' ? '你的消息' : 'la 的回复'">
      <CompactionNotice v-if="turn.messages[0].compact" :content="turn.messages[0].content" />
      <template v-else-if="turn.role === 'user'">
        <MessageActionTarget
          :items="userMenuItems(turn.messages[0])"
          :preview="turn.messages[0].displayContent ?? turn.messages[0].content"
          role-label="你的消息"
          label="消息操作"
          @select="onUserMenu(turn.messages[0], $event)"
        >
          <div class="rikka-message rikka-message--user">
            <div class="rikka-bubble rikka-bubble--user">
              <KimaMarkdown :content="turn.messages[0].displayContent ?? turn.messages[0].content" />
              <div v-if="turn.messages[0].attachments?.length" class="user-attachments">
                <span v-for="(file, index) in turn.messages[0].attachments" :key="file.id || `${index}-${file.name}`" class="user-attachment" :title="file.name">
                  <AppIcon name="document" :size="14" />
                  <span class="user-attachment__name">{{ file.name }}</span>
                </span>
              </div>
            </div>
          </div>
        </MessageActionTarget>
      </template>
      <template v-else>
        <AssistantTurn
          :messages="turn.messages"
          :session-id="session.id"
          :running="session.status === 'running'"
          @rollback="requestRollback"
          @fork="forkFrom"
        />
      </template>
    </article>
    <button v-if="!pinned" type="button" class="conversation-latest" @click="jumpToBottom">
      <AppIcon name="down" :size="14" />
      回到最新
    </button>
    <RollbackDialog
      ref="rollbackDialog"
      :target="rollbackTarget"
      :preview="rollbackPreview"
      @confirm="confirmRollback"
    />
  </div>
</template>

<style scoped lang="scss">
.conversation-flow { width: 100%; margin: 0; padding: 16px var(--la-chat-gutter); display: flex; flex-direction: column; gap: 12px; }
.conversation-top-sentinel { display: block; width: 100%; height: 1px; flex: none; }
.conversation-earlier {
  align-self: center;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border: 1px solid var(--la-line);
  border-radius: 999px;
  background: var(--la-layer-01);
  color: var(--la-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.conversation-earlier:hover { color: var(--la-text); background: var(--la-layer-02); }
.conversation-latest {
  position: sticky;
  bottom: 12px;
  z-index: 2;
  display: inline-flex;
  align-self: flex-end;
  align-items: center;
  gap: 5px;
  margin-right: 8px;
  padding: 7px 12px;
  border: 1px solid var(--la-line);
  border-radius: 999px;
  background: color-mix(in srgb, var(--la-panel) 92%, transparent);
  backdrop-filter: blur(10px);
  box-shadow: var(--la-shadow-floating);
  color: var(--la-text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.conversation-latest:hover { background: var(--la-layer-01); }
.message { display: block; min-width: 0; }

</style>
