<!--
一整轮助手回复：把自动接续产生的多条 assistant 消息合并成一条连续消息。
思考、工具合成一张时间线卡片；完成任务/询问用户这类结束工具的结果直接成为正式回复，不再套背景。
右键或长按这一整轮，可以复制、回退或分支。
-->
<script setup>
import { computed, ref, watch } from 'vue'
import { AppIcon } from '../ui/index.js'
import { UI } from '../commands/ui.js'
import { renderMarkdown } from '../utils/markdown.js'
import { canonicalToolName, outputText } from './tool-ui.js'
import MessageActionTarget from './MessageActionTarget.vue'
import ReasoningStep from './ReasoningStep.vue'
import ToolCallRow from './ToolCallRow.vue'

const props = defineProps({
  messages: { type: Array, required: true },
  sessionId: { type: String, required: true },
  running: Boolean,
})
const emit = defineEmits(['rollback', 'fork'])

const STOP_TOOLS = new Set(['attempt_completion', 'ask_followup_question'])
const isStopTool = tool => STOP_TOOLS.has(canonicalToolName(tool.name))
const actionable = message => Boolean(message.id) && !message.id.startsWith('pending_') && !message.id.startsWith('error_')

const expandedSteps = ref(false)
const steps = computed(() => {
  const list = []
  for (const message of props.messages) {
    if (message.reasoning) list.push({ key: `${message.id}-reasoning`, type: 'reasoning', message })
    for (const tool of message.tools || []) {
      if (!isStopTool(tool)) list.push({ key: tool.id || `${message.id}-${list.length}`, type: 'tool', tool })
    }
  }
  return list
})
const streaming = computed(() => props.messages.some(message => message.isStreaming))
const liveReasoning = computed(() => props.messages.some(message => message.isStreaming && message.reasoning))
// 流式思考时保持全部步骤可见；结束后超过两步才折叠，只留最后两步。
const canCollapse = computed(() => steps.value.length > 2 && !liveReasoning.value)
const hiddenCount = computed(() => canCollapse.value && !expandedSteps.value ? steps.value.length - 2 : 0)
const visibleSteps = computed(() => steps.value.slice(hiddenCount.value))

// 正文和结束工具的结果都是给用户看的回复；重复内容只保留一份。
const content = computed(() => {
  const parts = []
  const push = raw => {
    const text = String(raw || '').trim()
    if (!text) return
    if (parts.some(part => part === text || part.includes(text))) return
    const previous = parts.findIndex(part => text.includes(part))
    if (previous >= 0) parts[previous] = text
    else parts.push(text)
  }
  for (const message of props.messages) push(message.content)
  for (const message of props.messages) {
    for (const tool of message.tools || []) if (isStopTool(tool)) push(outputText(tool))
  }
  return parts.join('\n\n')
})
const error = computed(() => props.messages.findLast(message => message.error)?.error || '')
const usage = computed(() => {
  let input = 0
  let output = 0
  for (const message of props.messages) {
    input += Number(message.request?.input || 0)
    output += Number(message.request?.output || 0)
  }
  return { input, output }
})

const rollbackTarget = computed(() => props.messages.find(actionable) || null)
const forkTarget = computed(() => [...props.messages].reverse().find(actionable) || null)
const menuItems = computed(() => {
  const items = [{ value: 'copy', label: '复制消息', icon: 'copy', disabled: !content.value }]
  if (rollbackTarget.value && forkTarget.value) {
    items.push({ value: 'rollback', label: '回退到这条回复', icon: 'undo', disabled: props.running })
    items.push({ value: 'fork', label: '从这里分支', icon: 'branch', disabled: props.running })
  }
  return items
})

function onMenu(action) {
  if (action === 'copy') UI.copy(content.value)
  else if (action === 'rollback') emit('rollback', rollbackTarget.value)
  else if (action === 'fork') emit('fork', forkTarget.value)
}

watch(streaming, value => {
  if (value) expandedSteps.value = false
})
</script>

<template>
  <div class="assistant-message rikka-message rikka-message--assistant">
    <MessageActionTarget :items="menuItems" :preview="content" role-label="助手回复" label="助手消息操作" @select="onMenu">
      <div v-if="steps.length" class="cot-card">
        <button v-if="canCollapse" type="button" class="cot-more" :aria-expanded="expandedSteps" @click="expandedSteps = !expandedSteps">
          <span class="cot-more__icon"><AppIcon :name="expandedSteps ? 'up' : 'down'" :size="16" /></span>
          <span>{{ expandedSteps ? '收起步骤' : `展开其余 ${hiddenCount} 步` }}</span>
        </button>
        <div class="cot-steps">
          <template v-for="step in visibleSteps" :key="step.key">
            <ReasoningStep
              v-if="step.type === 'reasoning'"
              :reasoning="step.message.reasoning"
              :streaming="step.message.isStreaming"
              :started-at="step.message.startedAt"
              :finished-at="step.message.finishedAt"
            />
            <ToolCallRow
              v-else
              :tool="step.tool"
              :session-id="sessionId"
            />
          </template>
        </div>
      </div>

      <div v-if="content" class="rikka-bubble rikka-bubble--assistant" :class="{ 'is-streaming': streaming }">
        <div class="markdown-body" v-html="renderMarkdown(content)"></div>
        <span v-if="streaming" class="stream-caret" aria-hidden="true"></span>
      </div>

      <div v-if="streaming && !content && !steps.length" class="typing" role="status">
        <span></span><span></span><span></span><small>{{ messages.findLast(message => message.retry)?.retry || '正在思考' }}</small>
      </div>

      <p v-if="error" class="message__error" role="alert">{{ error }}</p>

      <p v-if="usage.input || usage.output" class="message__usage">
        输入 {{ usage.input.toLocaleString() }} <span>·</span>输出 {{ usage.output.toLocaleString() }} tokens
      </p>
    </MessageActionTarget>
  </div>
</template>
