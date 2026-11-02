<!-- 聊天页面：新会话是空状态，已有会话显示时间线；两种状态共用一套输入区接线。
调用：<ChatView :session="session" v-model:draft="draft" :files="files" @submit="createAndSend" />。
临时面板状态在这里；发送、附件、会话设置和回退分别调用 commands。
-->
<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import { Button } from '../ui/index.js'
import Composer from '../components/Composer.vue'
import AgentPicker from '../components/AgentPicker.vue'
import TaskPanel from '../components/TaskPanel.vue'
import { Session } from '../commands/session.js'
import { Chat } from '../commands/chat.js'
import { History, canContinueSession } from '../commands/history.js'
import { Navigation } from '../commands/navigation.js'
import { latestTodos } from '../commands/tool.js'

const Timeline = defineAsyncComponent(() => import('../components/Timeline.vue'))
const props = defineProps({
  session: { type: Object, default: null }, model: String, agent: { type: String, default: 'build' },
  reasoning: { type: String, default: 'auto' }, files: { type: Array, default: () => [] }, busy: Boolean, todoOpen: Boolean,
})
const emit = defineEmits(['submit', 'attach', 'remove-file', 'update:todoOpen', 'update:agent', 'update:reasoning'])
const homeDraft = defineModel('draft', { type: String, default: '' })
const composer = ref(null)
const conversationScroll = ref(null)
const agentOpen = ref(false)
const showReconnect = ref(false)
let reconnectTimer
defineExpose({ focus: () => composer.value?.focus() })

const draft = computed({
  get: () => props.session ? props.session.draft : homeDraft.value,
  set: value => { if (props.session) props.session.draft = value; else homeDraft.value = value },
})
const files = computed(() => props.session?.files || props.files)
const currentAgent = computed(() => props.session?.settings.agent || props.agent)
const reasoning = computed(() => props.session?.settings.reasoning || props.reasoning)
const resumable = computed(() => canContinueSession(props.session))
const todos = computed(() => {
  if (!props.session) return []
  const latest = latestTodos(props.session.messages)
  return latest.length ? latest : props.session.todos || []
})

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
  if (await Chat.send(id, content) && props.session?.id === id && draft.value === content) draft.value = ''
}
function attach(files) {
  if (props.session) void Chat.attach(props.session.id, files)
  else emit('attach', files)
}
function removeFile(id) {
  if (props.session) Chat.removeFile(props.session.id, id)
  else emit('remove-file', id)
}
function chooseAgent(agent) {
  if (props.session) void Session.setAgent(props.session.id, agent)
  else emit('update:agent', agent)
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
          <Transition name="session-swap" mode="out-in"><Timeline :key="session.id" :scroll-root="conversationScroll" /></Transition>
        </div>
        <Transition name="reconnect">
          <div v-if="session && showReconnect" class="reconnect-overlay" role="status" aria-live="polite">
            <div class="reconnect-card"><span  class="ui-spinner ui-spinner--large" aria-hidden="true"><span class="ui-spinner__ring"></span></span><strong>正在重新连接</strong><p>和后台的连接暂时断开。恢复后会自动回到这段对话。</p></div>
          </div>
        </Transition>
      </div>
      <div :class="[session ? 'session-composer' : 'draft-form', { 'is-reconnecting': showReconnect }]">
        <Transition name="notice"><div v-if="session && !session.model" class="chat-notice" role="status"><span>此对话还未配置模型。</span><Button variant="ghost" @click="Navigation.openSettings('providers')">连接模型</Button></div></Transition>
        <Transition name="notice"><div v-if="session?.undoable" class="chat-notice" role="status"><span>对话已回退{{ session.undoable > 1 ? `（可撤销 ${session.undoable} 步，发新消息后不能再撤销）` : '' }}</span><Button variant="ghost" @click="History.undoRollback(session.id)">撤销回退</Button></div></Transition>
        <Composer ref="composer" v-model:draft="draft" :selected-model="session ? session.model : model" :selected-provider="session?.provider || ''" :session-id="session?.id || ''" :reasoning="reasoning" :agent="Session.agentLabel(currentAgent)" :agent-open="agentOpen" show-session-controls :is-running="session?.status === 'running'" :can-continue="resumable" :busy="busy || session?.stopping" :files="files"
          @submit="submit" @stop="Chat.stop(session.id)" @continue="Chat.resume(session.id)" @attach="attach" @remove-file="removeFile" @open-agent="agentOpen = true" @update:reasoning="chooseReasoning" />
      </div>
    </div>
    <TaskPanel v-if="session" :open="todoOpen" :todos="todos" @update:open="emit('update:todoOpen', $event)" />
    <AgentPicker :open="agentOpen" :model-value="currentAgent" @update:open="agentOpen = $event" @select="chooseAgent" />
  </section>
</template>
<style scoped lang="scss" src="../styles/views/ChatView.scss"></style>
