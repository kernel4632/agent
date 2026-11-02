<!--
会话页：把时间线、输入区、任务清单面板和运行设置组装成完整的一页。
顶部标题和模型切换由 App 外的 TopBar 提供，这里不再带内部标题栏。
只负责会话自己的交互；打开会话、新建对话和全局快捷键仍由 App.vue 管。
普通按钮、下拉框和数字输入统一走 ui/；芯片和智能体按钮用 Button plain 保留原样式。
调用示例：
<SessionView
  v-else
  :session="session"
  :busy="creating || store.ui.isLoading || !!store.ui.errorMessage"
  v-model:todo-open="todoOpen"
/>
-->
<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import { KimaSpinner } from '../ui/index.js'
import { Button } from '../ui/index.js'
import Composer from '../composer/Composer.vue'
import AgentDrawer from './AgentDrawer.vue'
import SessionTodoPanel from './SessionTodoPanel.vue'
import { latestTodos } from './todos.js'
import { canContinueSession } from './continue.js'
import { Session } from './session.js'
import { Chat } from './chat.js'
import { UI } from '../app/ui.js'

// 时间线单独拆包，只有进入会话页时才加载。
const Timeline = defineAsyncComponent(() => import('./Timeline.vue'))

const props = defineProps({
  session: { type: Object, required: true }, // 当前打开的完整会话
  busy: Boolean,                             // 创建中、加载中或有连接错误时禁止发送
  todoOpen: Boolean,                         // 右侧任务清单是否打开，由 App 统一控制
})
const emit = defineEmits(['update:todoOpen'])

// --- 页面内的开关 ---
// 对话设置和任务清单都走右侧抽屉，不占输入框上方。
const agentOpen = ref(false)
const resumable = computed(() => canContinueSession(props.session))
const showReconnect = ref(false)
let reconnectTimer = null
// 短暂重连不闪覆盖层；连续断开 2 秒、且没有等待审批时才盖住时间线。
watch(
  [() => props.session.connection, () => props.session.status, () => props.session.pending?.length],
  ([connection, status, pending]) => {
    window.clearTimeout(reconnectTimer)
    if (connection === 'reconnecting' && status === 'running' && !pending) {
      reconnectTimer = window.setTimeout(() => { showReconnect.value = true }, 2000)
    } else {
      showReconnect.value = false
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => window.clearTimeout(reconnectTimer))

async function continueAssistant() {
  if (!resumable.value) return
  await Chat.resume(props.session.id)
}

// --- 输入草稿和附件 ---
// 草稿放在 session 上，切标签或打开设置再回来不会丢。
const draft = computed({
  get: () => props.session.draft,
  set: value => { props.session.draft = value },
})
const files = computed(() => props.session.files || [])
const conversationScroll = ref(null)
// 消息里的清单比 Session.todos 更新得更早，流式过程中也能立刻看到进度。
const todos = computed(() => {
  const fromMessages = latestTodos(props.session.messages)
  return fromMessages.length ? fromMessages : (props.session.todos || [])
})

// --- 发送与停止 ---
async function submitMessage(content) {
  if (props.busy) return
  if (await Chat.send(props.session.id, content)) {
    // 发送期间用户可能又输入了新内容，只清掉刚发出去的那份。
    if (props.session.draft === content) props.session.draft = ''
  }
}

function stop() { void Chat.stop(props.session.id) }

// --- 附件 ---
function attachFiles(selected) { void Chat.attach(props.session.id, selected) }
function removeFile(id) { Chat.removeFile(props.session.id, id) }

</script>

<template>
  <section class="session-panel" aria-label="聊天">
    <div class="session-main">
      <div class="session-conversation">
        <div ref="conversationScroll" class="session-scroll">
          <!-- 会话切换只替换时间线；输入区留在原处，草稿、焦点和滚动容器都不重建。 -->
          <Transition name="session-swap" mode="out-in">
            <Timeline :key="session.id" :scroll-root="conversationScroll" />
          </Transition>
        </div>
        <Transition name="reconnect">
          <div v-if="showReconnect" class="reconnect-overlay" role="status" aria-live="polite">
            <div class="reconnect-card">
              <KimaSpinner label="正在重新连接" size="large" decorative />
              <strong>正在重新连接</strong>
              <p>和后台的连接暂时断开。恢复后会自动回到这段对话。</p>
            </div>
          </div>
        </Transition>
      </div>
      <div class="session-composer" :class="{ 'is-reconnecting': showReconnect }">
        <Transition name="notice">
          <div v-if="!session.model" class="chat-notice" role="status"><span>此对话还未配置模型。</span><Button variant="ghost" @click="UI.openSettings('providers')">连接模型</Button></div>
        </Transition>
        <Transition name="notice">
          <div v-if="session.undoable" class="chat-notice" role="status"><span>对话已回退{{ session.undoable > 1 ? `（可撤销 ${session.undoable} 步，发新消息后不能再撤销）` : '' }}</span><Button variant="ghost" @click="Chat.undoRollback(session.id)">撤销回退</Button></div>
        </Transition>
        <Composer v-model:draft="draft" :selected-model="session.model" :selected-provider="session.provider" :reasoning="session.settings.reasoning" :session-id="session.id" :agent="Session.agentLabel(session.settings.agent)" :agent-open="agentOpen" show-session-controls :is-running="session.status === 'running'" :can-continue="resumable" :busy="busy || session.stopping" :files="files" @submit="submitMessage" @stop="stop" @continue="continueAssistant" @attach="attachFiles" @remove-file="removeFile" @open-agent="agentOpen = true" @update:reasoning="Session.setReasoning(session.id, $event)" />
      </div>
    </div>
    <SessionTodoPanel :open="todoOpen" :todos="todos" @update:open="emit('update:todoOpen', $event)" />
    <AgentDrawer :open="agentOpen" :model-value="session.settings.agent" @update:open="agentOpen = $event" @select="Session.setAgent(session.id, $event)" />
  </section>
</template>

<style scoped lang="scss" src="../styles/session/SessionView.scss"></style>
