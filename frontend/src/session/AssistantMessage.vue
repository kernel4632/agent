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
  model: { type: String, default: '' },
  running: Boolean,
  canRollback: Boolean,
})
const emit = defineEmits(['rollback', 'fork'])

const reasoningOpen = ref(false)
const preview = ref(null)
const latestReasoning = computed(() => (props.message.reasoning || '').slice(-600))

async function pinPreview() {
  await nextTick()
  if (preview.value) preview.value.scrollTop = preview.value.scrollHeight
}

watch(() => props.message.reasoning?.length || 0, pinPreview)
onMounted(pinPreview)
</script>

<template>
  <div class="assistant-message rikka-message rikka-message--assistant">
    <div class="rikka-message__head">
      <span class="rikka-avatar rikka-avatar--assistant" :class="{ 'is-thinking': message.isStreaming }" aria-hidden="true"><AppIcon name="spark" :size="14" /></span>
      <span class="rikka-message__model" :title="model">{{ model }}</span>
    </div>
    <div v-if="message.reasoning" class="rikka-card list-row list-row--thinking" :class="{ 'is-live': message.isStreaming && !message.content }">
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
    </div>

    <ToolCallRow
      v-for="tool in message.tools || []"
      :key="tool.id"
      class="rikka-card"
      :tool="tool"
      :message="message"
      :session-id="sessionId"
      :running="running"
      :can-rollback="canRollback"
      :show-actions="false"
      @rollback="emit('rollback')"
    />

    <div v-if="message.content" class="rikka-bubble rikka-bubble--assistant">
      <div class="markdown-body" v-html="renderMarkdown(message.content)"></div>
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

    <div v-if="!message.isStreaming" class="rikka-message__actions">
      <IconButton size="small" label="复制消息" title="复制消息" @click="UI.copy(message.content)"><AppIcon name="copy" :size="14" /></IconButton>
      <IconButton v-if="canRollback" size="small" label="回退到这条回复" title="删除这条消息及之后的内容" :disabled="running" @click="emit('rollback')"><AppIcon name="undo" :size="14" /></IconButton>
      <IconButton v-if="canRollback" size="small" label="从这里分支" title="从这条回复分出新的对话" :disabled="running" @click="$emit('fork')"><AppIcon name="branch" :size="14" /></IconButton>
    </div>
  </div>
</template>
