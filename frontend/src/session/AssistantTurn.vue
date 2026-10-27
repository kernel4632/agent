<!--
一整轮助手回复：把自动接续产生的多条 assistant 消息合并成一条连续消息。
思考、工具和中间正文按发生顺序合成一张时间线卡片；完成任务/询问用户这类结束工具的结果才是正式回复，直接显示在卡片下方，不再套背景。
没有结束工具时（停止、报错、断网）才把已经流出的正文当临时回复。
右键或长按这一整轮，可以复制、回退或分支。
调用示例：<AssistantTurn :messages="turn.messages" :session-id="session.id" :running="running" @rollback="..." @fork="..." />
-->
<script setup>
import { computed } from 'vue'
import { AppIcon, KimaMarkdown, SmoothMarkdown } from '../ui/index.js'
import { UI } from '../commands/ui.js'
import { useSmoothText } from '../utils/smooth-text.js'
import { outputText } from './tool-ui.js'
import { isFinishedStopTool } from './stop-tools.js'
import { isSavedMessage } from './continue.js'
import MessageActionTarget from './MessageActionTarget.vue'
import ReasoningStep from './ReasoningStep.vue'
import RequestStatus from './RequestStatus.vue'
import ToolCallRow from './ToolCallRow.vue'

const props = defineProps({
  messages: { type: Array, required: true },
  sessionId: { type: String, required: true },
  running: Boolean,
})
const emit = defineEmits(['rollback', 'fork'])

const actionable = message => isSavedMessage(message)

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
        if (text && text !== finalText.value.trim()) list.push({ key: `${message.id}-text-${index}`, type: 'text', text: entry.text })
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
// 全部都是正文时仍显示成普通气泡；有思考、工具或结束工具时，正文按原位置留在步骤里。
const textOnly = computed(() => !finalText.value && steps.value.length > 0 && steps.value.every(step => step.type === 'text'))
const showSteps = computed(() => steps.value.length > 0 && !textOnly.value)
const bubbleText = computed(() => finalText.value || (textOnly.value ? fallbackText.value : (!steps.value.length ? fallbackText.value : '')))
const { text: bubbleContent, done: bubbleDone } = useSmoothText(bubbleText)

const error = computed(() => props.messages.findLast(message => message.error)?.error || '')
// 一轮里可能请求模型多次；每次的请求行按顺序显示，刷新后从历史里的 usage 恢复。
const requests = computed(() => props.messages.flatMap(message => message.requests?.length ? message.requests : message.request ? [message.request] : []))

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
</script>

<template>
  <div class="assistant-message rikka-message rikka-message--assistant">
    <MessageActionTarget :items="menuItems" :preview="content" role-label="助手回复" label="助手消息操作" @select="onMenu">
      <RequestStatus v-if="requests.length" :requests="requests" />
      <div v-if="showSteps" class="cot-card">
        <div class="cot-steps">
          <template v-for="step in steps" :key="step.key">
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
                  <SmoothMarkdown :content="step.text" compact />
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

      <div v-if="bubbleText" class="rikka-bubble rikka-bubble--assistant" :class="{ 'is-streaming': streaming }">
        <KimaMarkdown :content="bubbleContent" />
        <!-- 结束工具结果已经完整时，光标只是在等连接关闭，不该继续闪。 -->
        <span v-if="!bubbleDone && !finalText" class="stream-caret" aria-hidden="true"></span>
      </div>

      <div v-if="streaming && !content && !steps.length" class="typing" role="status">
        <span></span><span></span><span></span><small>{{ messages.findLast(message => message.retry)?.retry || '正在思考' }}</small>
      </div>

      <p v-if="error" class="message__error" role="alert">{{ error }}</p>
    </MessageActionTarget>
  </div>
</template>
