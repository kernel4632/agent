<!--
一整轮助手回复：把自动接续产生的多条 assistant 消息合并成一条连续消息。
思考、工具和中间正文按发生顺序合成一张时间线卡片；完成任务/询问用户这类结束工具的结果才是正式回复，直接显示在卡片下方，不再套背景。
没有结束工具时（停止、报错、断网）才把已经流出的正文当临时回复。
右键或长按这一整轮，可以复制、回退或分支。
调用示例：<AssistantTurn :messages="turn.messages" :session-id="session.id" :running="running" @rollback="..." @fork="..." />
-->
<script setup>
import { computed, ref, watch } from 'vue'
import { AppIcon } from '../ui/index.js'
import { UI } from '../commands/ui.js'
import { renderMarkdown } from '../utils/markdown.js'
import { outputText } from './tool-ui.js'
import { isFinishedStopTool } from './stop-tools.js'
import MessageActionTarget from './MessageActionTarget.vue'
import ReasoningStep from './ReasoningStep.vue'
import ToolCallRow from './ToolCallRow.vue'

const props = defineProps({
  messages: { type: Array, required: true },
  sessionId: { type: String, required: true },
  running: Boolean,
})
const emit = defineEmits(['rollback', 'fork'])

const actionable = message => Boolean(message.id) && !message.id.startsWith('pending_') && !message.id.startsWith('error_')

const expandedSteps = ref(false)
// 结束工具才是正式回复；没有结束工具时（中断、报错）才把已经流出的正文当临时回复。
const stopTexts = computed(() => props.messages.flatMap(message =>
  (message.tools || [])
    .filter(isFinishedStopTool)
    .map(tool => outputText(tool).trim())
    .filter(Boolean)
))
const finalText = computed(() => stopTexts.value.at(-1) || '')
const fallbackText = computed(() => props.messages
  .map(message => String(message.content || '').trim())
  .filter(Boolean)
  .join('\n\n'))
const content = computed(() => finalText.value || fallbackText.value)

// 时间线按消息顺序排列：思考、非结束正文、工具步骤。
// 非结束正文不拼进最终回复，否则多轮自动接续会把几段话糊成一团。
const steps = computed(() => {
  const list = []
  for (const message of props.messages) {
    // 新消息带 steps（按原始 part 顺序）；旧历史退回“思考 → 正文 → 工具”。
    const sequence = message.steps?.length
      ? message.steps
      : [
          ...(message.reasoning ? [{ type: 'reasoning', text: message.reasoning }] : []),
          ...(message.content ? [{ type: 'text', text: message.content }] : []),
          ...(message.tools || []).map(tool => ({ type: 'tool', toolId: tool.id })),
        ]
    sequence.forEach((entry, index) => {
      if (entry.type === 'reasoning' && entry.text) {
        list.push({
          key: `${message.id}-reasoning-${index}`,
          type: 'reasoning',
          text: entry.text,
          message,
          streaming: message.isStreaming && entry.type === 'reasoning' && !sequence.slice(index + 1).some(step => step.type === 'reasoning'),
        })
      } else if (entry.type === 'text') {
        const text = String(entry.text || '').trim()
        // 有结束工具时，非结束正文只进时间线；没有结束工具时它还是临时回复，留在气泡里。
        if (text && finalText.value && text !== finalText.value) {
          list.push({ key: `${message.id}-text-${index}`, type: 'text', text: entry.text })
        }
      } else if (entry.type === 'tool') {
        const tool = (message.tools || []).find(item => item.id === entry.toolId)
        if (tool && !isFinishedStopTool(tool)) {
          list.push({ key: tool.id || `${message.id}-tool-${index}`, type: 'tool', tool })
        }
      }
    })
  }
  return list
})
const streaming = computed(() => props.messages.some(message => message.isStreaming))
// 流式思考时保持全部步骤可见；结束后超过两步才折叠，只留最后两步。
const canCollapse = computed(() => steps.value.length > 2 && !props.messages.some(message => message.isStreaming && message.reasoning))
const hiddenCount = computed(() => canCollapse.value && !expandedSteps.value ? steps.value.length - 2 : 0)
const visibleSteps = computed(() => steps.value.slice(hiddenCount.value))

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
              :reasoning="step.text"
              :streaming="step.streaming"
              :started-at="step.message.startedAt"
              :finished-at="step.message.finishedAt"
            />
            <div v-else-if="step.type === 'text'" class="cot-step cot-step--text">
              <span class="cot-step__icon"><AppIcon name="chat" :size="16" /></span>
              <div class="cot-step__main">
                <div class="cot-step__body cot-step__body--text">
                  <div class="markdown-body" v-html="renderMarkdown(step.text)"></div>
                </div>
              </div>
            </div>
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
