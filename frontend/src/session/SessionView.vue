<!--
会话页：把时间线、输入区、文件面板和运行设置组装成完整的一页。
顶部标题和模型切换由 App 外的 TopBar 提供，这里不再带内部标题栏。
只负责会话自己的交互；打开会话、新建对话和全局快捷键仍由 App.vue 管。
普通按钮、下拉框和数字输入统一走 ui/；芯片和模式按钮用 Button plain 保留原样式。
调用示例：
<SessionView
  v-else
  :session="session"
  :workspace="selectedWorkspace"
  :busy="creating || store.ui.isLoading || !!store.ui.errorMessage"
  v-model:review-open="reviewOpen"
/>
-->
<script setup>
import { computed, defineAsyncComponent, ref } from 'vue'
import { Button } from '../ui/index.js'
import Composer from '../composer/Composer.vue'
import SessionFilePanel from './SessionFilePanel.vue'
import SessionMorePanel from './SessionMorePanel.vue'
import SessionTodos from './SessionTodos.vue'
import { latestTodos } from './todos.js'
import { Session } from '../commands/session.js'
import { Chat } from '../commands/chat.js'
import { UI } from '../commands/ui.js'

// 时间线单独拆包，只有进入会话页时才加载。
const Timeline = defineAsyncComponent(() => import('./Timeline.vue'))

const props = defineProps({
  session: { type: Object, required: true }, // 当前打开的完整会话
  workspace: Object,                         // 会话所属工作区，给文件面板使用
  busy: Boolean,                             // 创建中、加载中或有连接错误时禁止发送
  reviewOpen: Boolean,                       // 右侧文件面板是否打开，由 App 统一控制
})
const emit = defineEmits(['update:reviewOpen'])

// --- 页面内的开关 ---
// "更多"面板默认收起：常用的是上面那几个开关，这里都是配一次就不动的。
const moreOpen = ref(false)

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
      <div ref="conversationScroll" class="session-scroll">
        <!-- 会话切换只替换时间线；输入区留在原处，草稿、焦点和滚动容器都不重建。 -->
        <Transition name="session-swap" mode="out-in">
          <Timeline :key="session.id" :scroll-root="conversationScroll" />
        </Transition>
      </div>
      <div class="session-composer">
        <Transition name="notice">
          <div v-if="!session.model" class="chat-notice"><span>此对话还未配置模型。</span><Button variant="ghost" @click="UI.openSettings('providers')">连接模型</Button></div>
        </Transition>
        <Transition name="panel">
          <SessionMorePanel v-if="moreOpen" :session="session" />
        </Transition>
        <Transition name="notice">
          <div v-if="session.connection === 'reconnecting'" class="chat-notice" role="status">连接中断，正在重连…</div>
        </Transition>
        <Transition name="notice">
          <div v-if="session.undoable" class="chat-notice"><span>对话已回退{{ session.undoable > 1 ? `（可撤销 ${session.undoable} 步，发新消息后不能再撤销）` : '' }}</span><Button variant="ghost" @click="Chat.undoRollback(session.id)">撤销回退</Button></div>
        </Transition>
        <Transition name="panel">
          <SessionTodos v-if="todos.length" :todos="todos" />
        </Transition>
        <Composer v-model:draft="draft" :selected-model="session.model" :selected-provider="session.provider" :session-id="session.id" :mode="Session.modeLabel(session.settings.mode)" show-session-controls :is-running="session.status === 'running'" :busy="busy || session.stopping" :files="files" @submit="submitMessage" @stop="stop" @attach="attachFiles" @remove-file="removeFile" @toggle-settings="moreOpen = !moreOpen" @toggle-mode="Session.toggleMode(session.id)" />
      </div>
    </div>
    <SessionFilePanel :open="reviewOpen" :session="session" :workspace="workspace" @update:open="emit('update:reviewOpen', $event)" />
  </section>
</template>

<style scoped lang="scss">
.session-panel { display: flex; min-height: 0; flex: 1; }
.session-main { display: flex; min-width: 0; flex: 1; flex-direction: column; }
.session-scroll { min-height: 0; flex: 1; overflow: auto; }
.session-composer { width: 100%; flex: none; padding: 0 var(--la-chat-gutter) 8px; }
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
.notice-enter-active, .panel-enter-active { transition: opacity var(--la-motion-enter) var(--kima-curve-standard), transform var(--la-motion-enter) var(--kima-curve-standard); }
.notice-leave-active, .panel-leave-active { transition: opacity var(--la-motion-exit) var(--kima-curve-standard), transform var(--la-motion-exit) var(--kima-curve-standard); }
.notice-enter-from, .notice-leave-to { opacity: 0; transform: translateY(var(--la-motion-rise-small)); }
.panel-enter-from, .panel-leave-to { opacity: 0; transform: translateY(var(--la-motion-rise)) scale(.985); }
/* 会话切换：旧时间线先淡出，新时间线再上移淡入，不在同一帧叠两套消息。 */
.session-swap-enter-active { transition: opacity var(--la-motion-enter) var(--kima-curve-standard), transform var(--la-motion-enter) var(--kima-curve-standard); }
.session-swap-leave-active { transition: opacity var(--la-motion-exit) var(--kima-curve-standard), transform var(--la-motion-exit) var(--kima-curve-standard); }
.session-swap-enter-from { opacity: 0; transform: translateY(var(--la-motion-rise)); }
.session-swap-leave-to { opacity: 0; transform: translateY(calc(var(--la-motion-rise) * -.75)); }
@media (prefers-reduced-motion: reduce) {
  .notice-enter-active, .notice-leave-active, .panel-enter-active, .panel-leave-active, .session-swap-enter-active, .session-swap-leave-active { transition-duration: .01ms; }
}
@media (max-width: 767px) {
  .session-composer { padding: 0 16px max(8px, env(safe-area-inset-bottom)); }
}
</style>
