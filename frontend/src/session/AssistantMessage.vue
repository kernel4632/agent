<!--
  一条助手消息：思考行、工具调用、正文、进度、错误和用量。
  Timeline 只按轮次排列这些组件；消息自己的展开状态和复制/回退动作留在这里。
-->
<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { AppIcon, IconButton } from '../ui/index.js'
import { UI } from '../commands/ui.js'
import { renderMarkdown } from '../utils/markdown.js'
import './conversation.scss'
import ToolCallRow from './ToolCallRow.vue'

const props = defineProps({
  message: { type: Object, required: true },
  sessionId: { type: String, required: true },
  running: Boolean,
  canRollback: Boolean,
})
const emit = defineEmits(['rollback'])

const reasoningOpen = ref(false)
const preview = ref(null)
const latestReasoning = computed(() => (props.message.reasoning || '').slice(-600))

// 一条助手消息只有一种消息级动作位置：思考行、正文行，或者最后一条工具行。
const actionKind = message => message.reasoning ? 'thinking' : message.content ? 'text' : message.tools?.length ? 'tool' : 'text'
const isLastTool = index => index === (props.message.tools || []).length - 1

async function pinPreview() {
  await nextTick()
  if (preview.value) preview.value.scrollTop = preview.value.scrollHeight
}

watch(() => props.message.reasoning?.length || 0, pinPreview)
onMounted(pinPreview)
</script>

<template>
  <div class="assistant-message">
    <div v-if="message.reasoning" class="list-row list-row--thinking" :class="{ 'is-live': message.isStreaming && !message.content }">
      <span class="list-row__icon"><AppIcon name="spark" :size="14" /></span>
      <div class="list-row__main">
        <button type="button" class="list-row__toggle" :aria-expanded="reasoningOpen" @click="reasoningOpen = !reasoningOpen">
          <span class="list-row__label" :class="{ 'is-live': message.isStreaming && !message.content }">思考过程</span>
          <span v-if="message.isStreaming && !message.content" class="list-row__status is-running">思考中</span>
          <AppIcon name="down" :size="14" class="row-caret" :class="{ 'is-open': reasoningOpen }" aria-hidden="true" />
        </button>
        <div v-if="message.isStreaming && message.reasoning" ref="preview" class="thinking-preview">
          <span class="thinking-preview__text">{{ latestReasoning }}</span><span class="thinking-preview__caret" aria-hidden="true">▍</span>
        </div>
        <div class="flow-content" :class="{ 'is-open': reasoningOpen }">
          <div class="flow-content__inner"><div class="flow-content__body"><p class="reasoning-text">{{ message.reasoning }}</p></div></div>
        </div>
      </div>
      <div v-if="!message.isStreaming && actionKind(message) === 'thinking'" class="list-row__actions message__actions">
        <IconButton size="small" label="复制消息" title="复制消息" @click="UI.copy(message.content)"><AppIcon name="copy" :size="14" /></IconButton>
        <IconButton v-if="canRollback" size="small" label="回退到这条回复" title="删除这条消息及之后的内容" :disabled="running" @click="emit('rollback')"><AppIcon name="undo" :size="14" /></IconButton>
      </div>
    </div>

    <ToolCallRow
      v-for="(tool, index) in message.tools || []"
      :key="tool.id"
      :tool="tool"
      :message="message"
      :session-id="sessionId"
      :running="running"
      :can-rollback="canRollback"
      :show-actions="!message.isStreaming && actionKind(message) === 'tool' && isLastTool(index)"
      @rollback="emit('rollback')"
    />

    <div v-if="message.content" class="list-row list-row--text">
      <span class="list-row__icon"><AppIcon name="document" :size="14" /></span>
      <div class="list-row__main markdown-body" v-html="renderMarkdown(message.content)"></div>
      <div v-if="!message.isStreaming && actionKind(message) === 'text'" class="list-row__actions message__actions">
        <IconButton size="small" label="复制消息" title="复制消息" @click="UI.copy(message.content)"><AppIcon name="copy" :size="14" /></IconButton>
        <IconButton v-if="canRollback" size="small" label="回退到这条回复" title="删除这条消息及之后的内容" :disabled="running" @click="emit('rollback')"><AppIcon name="undo" :size="14" /></IconButton>
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
</template>
