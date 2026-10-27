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
import { KimaSpinner } from '@kernel4632/kima'
import { Button } from '../ui/index.js'
import Composer from '../composer/Composer.vue'
import AgentDrawer from './AgentDrawer.vue'
import PermissionDrawer from './PermissionDrawer.vue'
import SessionTodoPanel from './SessionTodoPanel.vue'
import { latestTodos } from './todos.js'
import { canContinueSession } from './continue.js'
import { Session } from '../commands/session.js'
import { Chat } from '../commands/chat.js'
import { UI } from '../commands/ui.js'

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
const permissionOpen = ref(false)
const agentOpen = ref(false)
const resumable = computed(() => canContinueSession(props.session))
// 输入框下方的统计：上下文占用和这一轮累计的 token/耗时。
const stats = computed(() => {
  const messages = props.session.messages || []
  const requests = messages.flatMap(message => message.requests?.length ? message.requests : message.request ? [message.request] : [])
  const sum = key => requests.reduce((total, item) => total + Number(item[key] || 0), 0)
  const last = requests.at(-1)
  const input = sum('input')
  const output = sum('output')
  const total = requests.reduce((value, item) => value + Number(item.total || 0), 0) || input + output
  const limit = Number(props.session.contextLimit || 0)
  const used = Number(last?.input || props.session.contextTokens || 0)
  if (!requests.length && !used && !limit) return null
  return {
    context: { used, limit, threshold: props.session.settings?.compactThreshold || 0.8 },
    usage: {
      input,
      output,
      cacheRead: sum('cache'),
      cacheWrite: sum('cacheWrite'),
      total,
      requests: requests.length,
      durationMs: requests.reduce((value, item) => value + Number(item.durationMs || 0), 0),
    },
  }
})
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
        <Composer v-model:draft="draft" :selected-model="session.model" :selected-provider="session.provider" :reasoning="session.settings.reasoning" :session-id="session.id" :agent="Session.agentLabel(session.settings.agent)" :agent-open="agentOpen" :permissions-open="permissionOpen" :stats="stats" show-session-controls :is-running="session.status === 'running'" :can-continue="resumable" :busy="busy || session.stopping" :files="files" @submit="submitMessage" @stop="stop" @continue="continueAssistant" @attach="attachFiles" @remove-file="removeFile" @toggle-permissions="permissionOpen = !permissionOpen" @open-agent="agentOpen = true" @update:reasoning="Session.setReasoning(session.id, $event)" />
      </div>
    </div>
    <SessionTodoPanel :open="todoOpen" :todos="todos" @update:open="emit('update:todoOpen', $event)" />
    <PermissionDrawer :open="permissionOpen" :auto-approve="session.settings.autoApprove" :limit="session.settings.autoApproveLimit" @update:open="permissionOpen = $event" @toggle="Session.toggleAutoApprove(session.id, $event)" @update:limit="Session.setLimit(session.id, $event)" />
    <AgentDrawer :open="agentOpen" :model-value="session.settings.agent" @update:open="agentOpen = $event" @select="Session.setAgent(session.id, $event)" />
  </section>
</template>

<style scoped lang="scss">
.session-panel { display: flex; min-height: 0; flex: 1; }
.session-main { position: relative; display: flex; min-width: 0; flex: 1; flex-direction: column; }
.session-conversation { position: relative; display: flex; min-height: 0; flex: 1; flex-direction: column; }
.session-scroll { min-height: 0; flex: 1; overflow: auto; }
.session-composer { width: 100%; flex: none; padding: 0 var(--la-chat-gutter) 8px; transition: filter var(--la-motion-enter) var(--kima-curve-standard), opacity var(--la-motion-enter) var(--kima-curve-standard); }
.session-composer.is-reconnecting { filter: blur(2px); opacity: .6; }
.chat-notice {
  display: flex;
  width: fit-content;
  max-width: 100%;
  align-items: center;
  align-self: flex-start;
  gap: 10px;
  margin-bottom: 12px;
  padding: 10px 16px;
  border-radius: 999px;
  background: var(--la-layer-02);
  color: var(--la-secondary);
  font-size: 14px;
  line-height: 20px;
}
.chat-notice[role="status"]::before {
  content: '';
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 50%;
  background: var(--la-warning);
}
/* 输入框上方的提示和面板统一从下往上出现，离开时更快消失。 */
.notice-enter-active { transition: opacity var(--la-motion-enter) var(--kima-curve-standard), transform var(--la-motion-enter) var(--kima-curve-standard); }
.notice-leave-active { transition: opacity var(--la-motion-exit) var(--kima-curve-standard), transform var(--la-motion-exit) var(--kima-curve-standard); }
.notice-enter-from, .notice-leave-to { opacity: 0; transform: translateY(var(--la-motion-rise-small)); }
/* 断线重连：直接盖住对话区和输入区，背景虚化，只留一句状态和加载动画。 */
.reconnect-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: 24px;
  background: color-mix(in srgb, var(--la-bg) 55%, transparent);
  backdrop-filter: blur(16px) saturate(120%);
}
.reconnect-card {
  display: grid;
  max-width: 320px;
  justify-items: center;
  gap: 12px;
  padding: 28px 30px;
  border: .5px solid var(--la-line);
  border-radius: 24px;
  background: color-mix(in srgb, var(--la-panel) 88%, transparent);
  box-shadow: var(--la-shadow-floating);
  text-align: center;
}
.reconnect-card strong { color: var(--la-text); font-size: 18px; font-weight: 600; line-height: 26px; }
.reconnect-card p { margin: 0; color: var(--la-muted); font-size: 13.5px; line-height: 20px; }
.reconnect-enter-active, .reconnect-leave-active { transition: opacity var(--la-motion-enter) var(--kima-curve-standard); }
.reconnect-enter-from, .reconnect-leave-to { opacity: 0; }
/* 会话切换：旧时间线先淡出，新时间线再上移淡入，不在同一帧叠两套消息。 */
.session-swap-enter-active { transition: opacity var(--la-motion-enter) var(--kima-curve-standard), transform var(--la-motion-enter) var(--kima-curve-standard); }
.session-swap-leave-active { transition: opacity var(--la-motion-exit) var(--kima-curve-standard), transform var(--la-motion-exit) var(--kima-curve-standard); }
.session-swap-enter-from { opacity: 0; transform: translateY(var(--la-motion-rise)); }
.session-swap-leave-to { opacity: 0; transform: translateY(calc(var(--la-motion-rise) * -.75)); }
@media (prefers-reduced-motion: reduce) {
  .notice-enter-active, .notice-leave-active, .session-swap-enter-active, .session-swap-leave-active { transition-duration: .01ms; }
}
@media (max-width: 767px) {
  .session-composer { padding: 0 16px max(8px, env(safe-area-inset-bottom)); }
}
</style>
