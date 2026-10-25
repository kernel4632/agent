<!--
一条助手消息：思考/工具合并成一张嵌套的思考卡片，正文气泡在下方。
头像、名字和模型名不再显示；用户只看到思考步骤、工具和回答。
-->
<script setup>
import { computed, ref, watch } from 'vue'
import { AppIcon, IconButton } from '../ui/index.js'
import { UI } from '../commands/ui.js'
import { renderMarkdown } from '../utils/markdown.js'
import './conversation.scss'
import ReasoningStep from './ReasoningStep.vue'
import ToolCallRow from './ToolCallRow.vue'

const props = defineProps({
  message: { type: Object, required: true },
  sessionId: { type: String, required: true },
  running: Boolean,
  canRollback: Boolean,
})
const emit = defineEmits(['rollback', 'fork'])

const speaking = ref(false)
const expandedSteps = ref(false)
const tools = computed(() => props.message.tools || [])
const stepCount = computed(() => (props.message.reasoning ? 1 : 0) + tools.value.length)
// 流式思考时保持全部步骤可见；结束后超过两步才折叠，只留最后两步。
const canCollapse = computed(() => stepCount.value > 2 && !(props.message.isStreaming && props.message.reasoning))
const hiddenCount = computed(() => canCollapse.value && !expandedSteps.value ? stepCount.value - 2 : 0)
const showReasoning = computed(() => Boolean(props.message.reasoning) && hiddenCount.value === 0)
const visibleTools = computed(() => {
  const hiddenTools = Math.max(0, hiddenCount.value - (props.message.reasoning ? 1 : 0))
  return tools.value.slice(hiddenTools)
})

watch(() => props.message.isStreaming, streaming => {
  if (streaming) expandedSteps.value = false
})

function toggleSpeech() {
  if (!props.message.content) return
  if (!('speechSynthesis' in window)) {
    UI.notify('当前浏览器不支持朗读')
    return
  }
  if (speaking.value) {
    window.speechSynthesis.cancel()
    speaking.value = false
    return
  }
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(props.message.content)
  utterance.lang = 'zh-CN'
  utterance.onend = () => { speaking.value = false }
  utterance.onerror = () => { speaking.value = false }
  speaking.value = true
  window.speechSynthesis.speak(utterance)
}
</script>

<template>
  <div class="assistant-message rikka-message rikka-message--assistant">
    <div v-if="stepCount" class="cot-card">
      <button v-if="canCollapse" type="button" class="cot-more" :aria-expanded="expandedSteps" @click="expandedSteps = !expandedSteps">
        <span class="cot-more__icon"><AppIcon :name="expandedSteps ? 'up' : 'down'" :size="16" /></span>
        <span>{{ expandedSteps ? '收起步骤' : `展开其余 ${hiddenCount} 步` }}</span>
      </button>
      <div class="cot-steps">
        <ReasoningStep
          v-if="showReasoning"
          :reasoning="message.reasoning"
          :streaming="message.isStreaming"
          :started-at="message.startedAt"
          :finished-at="message.finishedAt"
        />
        <ToolCallRow
          v-for="tool in visibleTools"
          :key="tool.id"
          :tool="tool"
          :session-id="sessionId"
        />
      </div>
    </div>

    <div v-if="message.content" class="rikka-bubble rikka-bubble--assistant" :class="{ 'is-streaming': message.isStreaming }">
      <div class="markdown-body" v-html="renderMarkdown(message.content)"></div>
      <span v-if="message.isStreaming" class="stream-caret" aria-hidden="true"></span>
    </div>

    <div v-if="message.isStreaming && !message.content && !message.reasoning && !tools.length" class="typing" role="status">
      <span></span><span></span><span></span><small>{{ message.retry || '正在思考' }}</small>
    </div>

    <p v-if="message.error" class="message__error" role="alert">{{ message.error }}</p>

    <p v-if="message.request?.input || message.request?.output" class="message__usage">
      输入 {{ message.request.input.toLocaleString() }} <span>·</span>输出 {{ message.request.output.toLocaleString() }} tokens
    </p>

    <div v-if="!message.isStreaming" class="rikka-message__actions">
      <IconButton size="small" label="复制消息" title="复制消息" @click="UI.copy(message.content)"><AppIcon name="copy" :size="14" /></IconButton>
      <IconButton v-if="message.content" size="small" :label="speaking ? '停止朗读' : '朗读回复'" :title="speaking ? '停止朗读' : '朗读回复'" @click="toggleSpeech"><AppIcon :name="speaking ? 'volume-off' : 'volume'" :size="14" /></IconButton>
      <IconButton v-if="canRollback" size="small" label="回退到这条回复" title="删除这条消息及之后的内容" :disabled="running" @click="emit('rollback')"><AppIcon name="undo" :size="14" /></IconButton>
      <IconButton v-if="canRollback" size="small" label="从这里分支" title="从这条回复分出新的对话" :disabled="running" @click="$emit('fork')"><AppIcon name="branch" :size="14" /></IconButton>
    </div>
  </div>
</template>
