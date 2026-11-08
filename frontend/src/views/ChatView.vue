<!-- 聊天页面：新会话是空状态，已有会话显示时间线；两种状态共用一套输入区接线。
调用：<ChatView :session="session" v-model:draft="draft" :files="files" @submit="createAndSend" />。
临时面板状态在这里；发送、附件、会话设置和回退分别调用 commands。
-->
<script setup>
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Button from '../ui/Button.vue'
import Composer from '../components/composer/Composer.vue'
import ConnectionError from '../components/feedback/ConnectionError.vue'
import TaskPanel from '../components/activity/TaskPanel.vue'
import StatsPanel from '../components/activity/StatsPanel.vue'
import ConversationRail from '../components/conversation/ConversationRail.vue'
import { Session } from "../features/session.js"
import { store } from '../store.js'
import { Chat } from '../commands/chat.js'
import { History } from "../features/history.js"
import { canContinueSession } from "../features/turns.js"
import { Navigation } from '../commands/navigation.js'
import { latestTodos } from "../utils/tool.js"
import { sessionStats } from "../features/stats.js"
import { savePath } from '../utils/session-view.js'

const Timeline = defineAsyncComponent(() => import('../components/conversation/Timeline.vue'))
const props = defineProps({
  session: { type: Object, default: null }, model: String,
  reasoning: { type: String, default: 'auto' }, files: { type: Array, default: () => [] }, busy: Boolean, todoOpen: Boolean,
  error: { type: String, default: '' },
})
const emit = defineEmits(['submit', 'attach', 'remove-file', 'update:todoOpen', 'update:reasoning'])
const homeDraft = defineModel('draft', { type: String, default: '' })
const composer = ref(null)
const timeline = ref(null)
const conversationScroll = ref(null)
const showReconnect = ref(false)
let reconnectTimer
defineExpose({ focus: () => composer.value?.focus(), jumpToMessage })
async function jumpToMessage(target) {
  const messageId = typeof target === 'string' ? target : target?.id
  const index = typeof target === 'object' ? target?.index : undefined
  if (!messageId) return
  if (props.session && !props.session.messages.some(message => message.id === messageId)) {
    if (!Number.isInteger(index)) return
    const loaded = await History.loadAround(props.session.id, index)
    if (!loaded) return
    await nextTick()
  }
  timeline.value?.jumpToMessage(messageId)
}

const draft = computed({
  get: () => props.session ? props.session.draft : homeDraft.value,
  set: value => { if (props.session) props.session.draft = value; else homeDraft.value = value },
})
const files = computed(() => props.session?.files || props.files)
const queued = computed(() => props.session ? (store.ui.queued[props.session.id] || []) : [])
const reasoning = computed(() => props.session?.settings.reasoning || props.reasoning)
const resumable = computed(() => canContinueSession(props.session))
const stats = computed(() => props.session ? sessionStats(props.session) : null)
const todos = computed(() => {
  if (!props.session) return []
  const latest = latestTodos(props.session.messages)
  return latest.length ? latest : props.session.todos || []
})

// 打开已有会话就接上实时事件：刷新页面或任务在别的客户端跑着时，也能继续看到进度。
// 同时把当前会话记成“上次位置”，刷新后 main.js 会按它恢复。
watch(() => props.session?.id, id => {
  if (!id) return
  savePath({ view: 'chat', sessionId: id })
  void Chat.subscribe(id)
}, { immediate: true })

// 连续重连两秒才显示遮罩；审批中仍显示原来的许可操作。
watch([() => props.session?.connection, () => props.session?.status, () => props.session?.pending?.length], ([connection, status, pending]) => {
  clearTimeout(reconnectTimer)
  if (connection === 'reconnecting' && status === 'running' && !pending) reconnectTimer = setTimeout(() => { showReconnect.value = true }, 2000)
  else showReconnect.value = false
}, { immediate: true })
onBeforeUnmount(() => clearTimeout(reconnectTimer))

async function submit(content) {
  if (props.busy) return
  if (!props.session) { emit('submit', content); return }
  const id = props.session.id
  // 运行中不丢消息：先把文字和附件收进本地队列，等这一轮空闲再发。
  if (props.session.status === 'running' || (store.ui.queued[id] || []).length || props.session.stopping) {
    const item = Chat.enqueue(id, content)
    if (item && draft.value === content) draft.value = ''
    return
  }
  if (await Chat.send(id, content) && props.session?.id === id && draft.value === content) {
    draft.value = ''
    timeline.value?.jumpToBottom()
  }
}
function withdrawQueued(queuedID) {
  if (!props.session) return
  Chat.withdrawQueued(props.session.id, queuedID)
  nextTick(() => composer.value?.focus())
}
function attach(files, options) {
  if (props.session) void Chat.attach(props.session.id, files, options)
  else emit('attach', files, options)
}
function removeFile(id) {
  if (props.session) Chat.removeFile(props.session.id, id)
  else emit('remove-file', id)
}
function chooseReasoning(reasoning) {
  if (props.session) void Session.setReasoning(props.session.id, reasoning)
  else emit('update:reasoning', reasoning)
}
</script>

<template>
  <section :class="session ? 'session-panel' : 'draft-panel'" :aria-label="session ? '聊天' : '新会话'">
    <div :class="session ? 'session-main' : 'draft-main'">
      <div :class="session ? 'session-conversation' : 'draft-empty'" :aria-hidden="session ? undefined : 'true'">
        <div v-if="session" ref="conversationScroll" class="session-scroll">
          <Transition name="session-swap" mode="out-in"><Timeline ref="timeline" :key="session.id" :scroll-root="conversationScroll" /></Transition>
        </div>
        <ConversationRail
          v-if="session"
          :messages="session.messages"
          :session-id="session.id"
          :scroll-root="conversationScroll"
          @jump="jumpToMessage"
        />
      </div>
      <div :class="[session ? 'session-composer' : 'draft-form']">
        <Transition name="notice"><div v-if="session && !session.model" class="chat-notice" role="status"><span>此对话还未配置模型。</span><Button variant="ghost" @click="Navigation.openSettings('providers')">连接模型</Button></div></Transition>
        <Transition name="notice"><div v-if="session?.undoable" class="chat-notice chat-notice--undo" role="status" aria-live="polite">
          <div class="chat-notice__copy">
            <span class="chat-notice__title">{{ session.rollback?.where || '对话已回退' }}{{ session.undoable > 1 ? ` · 可撤销 ${session.undoable} 步` : '' }}{{ session.rollback?.files ? ` · 恢复 ${session.rollback.files} 个文件` : '' }}</span>
            <span v-if="session.rollback?.preview" class="chat-notice__preview">“{{ session.rollback.preview }}”</span>
          </div>
          <Button variant="ghost" @click="History.undoRollback(session.id)">撤销回退</Button>
        </div></Transition>
        <div class="composer-state-host">
          <Transition name="alert"><div v-if="error" class="connection-overlay"><ConnectionError :message="error" /></div></Transition>
          <Transition name="reconnect">
            <div v-if="session && showReconnect" class="reconnect-overlay" role="status" aria-live="polite">
              <div class="reconnect-card"><span class="ui-spinner ui-spinner--large" aria-hidden="true"><span class="ui-spinner__ring"></span></span><strong>正在重新连接</strong></div>
            </div>
          </Transition>
          <Composer ref="composer" v-model:draft="draft" :blocked="!!error || showReconnect" :selected-model="session ? session.model : model" :selected-provider="session?.provider || ''" :session-id="session?.id || ''" :reasoning="reasoning" :is-running="session?.status === 'running'" :can-continue="resumable" :busy="busy || session?.stopping" :files="files" :queued="queued" :draft-workspace="store.ui.draftCwd"
            @submit="submit" @stop="Chat.stop(session.id)" @continue="Chat.resume(session.id)" @attach="attach" @remove-file="removeFile" @withdraw="withdrawQueued" @update:reasoning="chooseReasoning" @update:draft-workspace="store.ui.draftCwd = $event" />
        </div>
        <div v-if="stats" class="session-composer__stats"><StatsPanel :stats="stats" /></div>
      </div>
    </div>
    <TaskPanel v-if="session" :open="todoOpen" :todos="todos" @update:open="emit('update:todoOpen', $event)" />
  </section>
</template>
<style scoped lang="scss" src="../styles/views/ChatView.scss"></style>
