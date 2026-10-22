<!--
  会话时间线：按顺序显示消息、思考过程、工具调用与审批，以及回退和分支操作。
  只被会话页使用；自己从 store 读当前会话，不需要传 props。
  整个对话流是一列三行布局的列表：图标、文本、右侧操作；不使用卡片容器。
  按钮和图标按钮走 ui/；回退弹窗独立为 RollbackDialog，时间线只负责发起和确认。
  调用示例：
  <Timeline :key="session.id" />
-->
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AppIcon, IconButton } from '../ui/index.js'
import { store } from '../store.js'
import { Chat } from '../commands/chat.js'
import { Session } from '../commands/session.js'
import { UI } from '../commands/ui.js'
import { groupMessageTurns } from './turns.js'
import './conversation.scss'
import AssistantMessage from './AssistantMessage.vue'
import RollbackDialog from './RollbackDialog.vue'
import 'highlight.js/styles/github-dark.css'
import 'katex/dist/katex.min.css'

const props = defineProps({
    // 滚动容器由页面显式传入，不在组件里靠 class 查找祖先。
    scrollRoot: { type: Object, default: null },
})
const root = ref(null)
const session = computed(() => store.sessions[store.ui.activeSessionID])
const messages = computed(() => session.value?.messages || [])
// 一条用户消息和它后面自动接续的所有助手消息算一轮，头像和名字每轮只显示一次。
const turns = computed(() => groupMessageTurns(messages.value))
const pinned = ref(true)
const rollbackTarget = ref(null)
const rollbackDialog = ref(null)
const rollbackPreview = ref(null)
let scrollParent
function onScroll() { pinned.value = scrollParent.scrollHeight - scrollParent.scrollTop - scrollParent.clientHeight < 100 }
function scrollToBottom() { nextTick(() => { if (pinned.value && scrollParent) scrollParent.scrollTop = scrollParent.scrollHeight }) }
watch(messages, scrollToBottom, { deep: true })
onMounted(() => { scrollParent = props.scrollRoot || root.value?.closest('.session-scroll'); scrollParent?.addEventListener('scroll', onScroll, { passive: true }); scrollToBottom() })
onBeforeUnmount(() => scrollParent?.removeEventListener('scroll', onScroll))
// 只回退后端存过的消息；pending 和本地错误消息没有可用的 messageId。
const canRollback = message => Boolean(message.id) && !message.id.startsWith('pending_') && !message.id.startsWith('error_')
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
</script>

<template>
  <div ref="root" class="conversation-flow" role="log" aria-label="对话内容">
    <article v-for="turn in turns" :key="turn.id" class="message" :class="`message--${turn.role}`" :aria-label="turn.role === 'user' ? '你的消息' : 'la 的回复'">
      <template v-if="turn.role === 'user'">
        <div class="rikka-message rikka-message--user">
          <div class="rikka-message__head">
            <span class="rikka-message__name">你</span>
            <span class="rikka-avatar rikka-avatar--user" aria-hidden="true">你</span>
          </div>
          <div class="rikka-bubble rikka-bubble--user">{{ turn.messages[0].content }}</div>
          <div v-if="!turn.messages[0].isStreaming" class="rikka-message__actions">
            <IconButton size="small" label="复制消息" title="复制消息" @click="UI.copy(turn.messages[0].content)"><AppIcon name="copy" :size="14" /></IconButton>
            <IconButton v-if="canRollback(turn.messages[0])" size="small" label="回退到这条消息" title="删除这条消息及之后的内容" :disabled="session.status === 'running'" @click="requestRollback(turn.messages[0])"><AppIcon name="undo" :size="14" /></IconButton>
            <IconButton v-if="canRollback(turn.messages[0])" size="small" label="从这里分支" title="从这条消息分出新的对话" :disabled="session.status === 'running'" @click="forkFrom(turn.messages[0])"><AppIcon name="branch" :size="14" /></IconButton>
          </div>
        </div>
      </template>
      <template v-else>
        <div class="assistant-thread">
          <AssistantMessage
            v-for="message in turn.messages"
            :key="message.id"
            :message="message"
            :session-id="session.id"
            :model="session.model"
            :running="session.status === 'running'"
            :can-rollback="canRollback(message)"
            @rollback="requestRollback(message)"
            @fork="forkFrom(message)"
          />
        </div>
      </template>
    </article>
    <RollbackDialog
      ref="rollbackDialog"
      :target="rollbackTarget"
      :preview="rollbackPreview"
      @confirm="confirmRollback"
    />
  </div>
</template>

<style scoped lang="scss">
.conversation-flow { width: 100%; max-width: var(--la-chat-width); margin: 0 auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.message { display: block; min-width: 0; animation: row-in .18s ease-out both; }
@keyframes row-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

</style>
