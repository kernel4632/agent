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
import { store } from '../store.js'
import { Chat } from '../commands/chat.js'
import { Session } from '../commands/session.js'
import { UI } from '../commands/ui.js'
import { groupMessageTurns } from './turns.js'
import { renderMarkdown } from '../utils/markdown.js'
import { hasStopTool } from './stop-tools.js'
import { AppIcon, Button } from '../ui/index.js'
import MessageActionTarget from './MessageActionTarget.vue'
import './conversation.scss'
import AssistantTurn from './AssistantTurn.vue'
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

function userMenuItems(message) {
  const items = [{ value: 'copy', label: '复制消息', icon: 'copy' }]
  if (canRollback(message)) {
    items.push({ value: 'rollback', label: '回退到这条消息', icon: 'undo' })
    items.push({ value: 'fork', label: '从这里分支', icon: 'branch' })
  }
  return items
}

function onUserMenu(message, action) {
  if (action === 'copy') UI.copy(message.content)
  else if (action === 'rollback') requestRollback(message)
  else if (action === 'fork') forkFrom(message)
}

// 只有最后一轮助手没有调用结束工具时才提供继续；正常收尾的回复不再追着模型跑。
const canContinue = computed(() => {
  if (!session.value || session.value.status === 'running') return false
  const turn = turns.value.at(-1)
  if (!turn || turn.role !== 'assistant') return false
  return !hasStopTool(turn.messages) && canRollback(turn.messages.at(-1))
})

async function continueAssistant() {
  if (!session.value || !canContinue.value) return
  await Chat.resume(session.value.id)
}
</script>

<template>
  <div ref="root" class="conversation-flow" role="log" aria-label="对话内容">
    <article v-for="turn in turns" :key="turn.id" class="message" :class="`message--${turn.role}`" :aria-label="turn.role === 'user' ? '你的消息' : 'la 的回复'">
      <template v-if="turn.role === 'user'">
        <MessageActionTarget
          :items="userMenuItems(turn.messages[0])"
          :preview="turn.messages[0].content"
          role-label="你的消息"
          label="消息操作"
          @select="onUserMenu(turn.messages[0], $event)"
        >
          <div class="rikka-message rikka-message--user">
            <div class="rikka-bubble rikka-bubble--user">
              <div class="markdown-body" v-html="renderMarkdown(turn.messages[0].content)"></div>
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
    <Transition name="continue">
      <div v-if="canContinue" class="continue-row">
        <Button variant="tonal" class="continue-button" @click="continueAssistant">
          <AppIcon name="play" :size="18" /><span>继续助手</span>
        </Button>
      </div>
    </Transition>
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
.message { display: block; min-width: 0; animation: row-in .18s ease-out both; }
@keyframes row-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.continue-row { display: flex; justify-content: flex-start; padding: 2px 0 18px; }
.continue-button { min-height: 44px; padding: 0 20px; border-radius: 999px; gap: 8px; }
.continue-enter-active { transition: opacity .18s ease, transform .24s cubic-bezier(.2, 0, 0, 1); }
.continue-leave-active { transition: opacity .14s ease, transform .14s ease; }
.continue-enter-from, .continue-leave-to { opacity: 0; transform: translateY(8px); }

</style>
