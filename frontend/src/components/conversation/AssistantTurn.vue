<!--
一整轮助手回复：把自动接续产生的多条 assistant 消息合并成一条连续消息。
思考、工具和中间正文按发生顺序合成一张时间线卡片；完成任务/询问用户这类结束工具的结果才是正式回复，直接显示在卡片下方，不再套背景。
没有结束工具时（停止、报错、断网）才把已经流出的正文当临时回复。
右键或长按这一整轮，直接打开聚光引导（见 MessageActions）：框住落点所在的那条消息和它的工具，菜单卡片只给复制/回退/分支三个按钮；复制目标那一条的内容（stop 工具输出或正文），不展示预览。
调用示例：<AssistantTurn :messages="turn.messages" :session-id="session.id" :running="running" :rollback-target="..." :rollback-preview="..." @rollback="..." @fork="..." @rollback-confirm="..." />
-->
<script setup>
import { Notice } from '../../commands/notice.js'
import { copyText } from '../../utils/clipboard.js'

import { computed, ref } from 'vue'
import Icon from '../../ui/Icon.vue'
import Markdown from '../../ui/Markdown.vue'
import { useSmoothText } from '../../utils/smooth-text.js'
import { outputText } from '../../commands/tool.js'
import { isFinishedStopTool } from '../../commands/history.js'
import { isSavedMessage } from '../../commands/history.js'
import MessageActions from './MessageActions.vue'
import RequestStatus from '../feedback/RequestStatus.vue'
import ReasoningStep from './ReasoningStep.vue'
import ToolCall from '../activity/ToolCall.vue'

const props = defineProps({
  messages: { type: Array, required: true },
  sessionId: { type: String, required: true },
  running: Boolean,
  rollbackPreview: { type: Object, default: null },   // Timeline 拿到的后端代价预览，传给聚光卡片
  rollbackTarget: { type: Object, default: null },    // 正在确认回退的目标；清空表示已结束
})
const emit = defineEmits(['rollback', 'fork', 'rollback-confirm'])

// 复制目标那一条消息自己的内容：正式回复取结束工具的输出，否则取正文。
function messageText(message) {
  if (!message) return content.value
  const stopTool = (message.tools || []).find(isFinishedStopTool)
  return (stopTool ? outputText(stopTool).trim() : String(message.content || '').trim()) || content.value
}

// 右键落点决定回退/分支的目标消息：点在哪一步就归哪条助手消息；
// 打开聚光时由 resolveTarget 从事件里解析（找不到时保留 null，退回默认目标）。
const targetId = ref(null)
const targeted = messageId => {
    const message = props.messages.find(item => item.id === messageId)
    return message && actionable(message) ? message : null
}

// 压缩预览滚动到最新一行：内容一直在追加，停在顶部就看不到模型正在写什么。
const vAutoScroll = {
  mounted: element => { element.scrollTop = element.scrollHeight },
  updated: element => { element.scrollTop = element.scrollHeight },
}

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
// 正式气泡的归属：它来自带结束工具的那条消息；没有结束工具时（textOnly）
// 气泡显示的是最后一条消息流出的正文，回退聚光也按这条框住它。
const finalMessage = computed(() => [...props.messages].reverse().find(message => (message.tools || []).some(isFinishedStopTool)) || null)
const bubbleMessageId = computed(() => finalMessage.value?.id || defaultTarget.value?.id || null)

// 时间线按消息顺序排列：请求行、思考、非结束正文、工具步骤。
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
          messageId: message.id,
          streaming: message.isStreaming && entry.type === 'reasoning' && !sequence.slice(index + 1).some(step => step.type === 'reasoning'),
        })
      } else if (entry.type === 'text') {
        const text = String(entry.text || '').trim()
        if (text && text !== finalText.value.trim()) list.push({ key: `${message.id}-text-${index}`, type: 'text', text: entry.text, messageId: message.id })
      } else if (entry.type === 'tool') {
        const tool = (message.tools || []).find(item => item.id === entry.toolId)
        if (tool && !isFinishedStopTool(tool)) list.push({ key: tool.id || `${message.id}-tool-${index}`, type: 'tool', tool, messageId: message.id })
      } else if (entry.type === 'request') {
        const request = (message.requests || []).find(item => item.id === entry.requestId)
        if (request) list.push({ key: `${message.id}-request-${index}`, type: 'request', request, messageId: message.id })
      } else if (entry.type === 'compact') {
        list.push({ key: `${message.id}-compact-${index}`, type: 'compact', request: entry.request, messageId: message.id })
      }
    })
  }
  return list
})
// 请求行和压缩行都不算正文：只有文字时仍然显示成普通气泡。
const contentSteps = computed(() => steps.value.filter(step => step.type !== 'request' && step.type !== 'compact'))
const streaming = computed(() => props.messages.some(message => message.isStreaming))
// 历史步骤很多时默认只留最后两步，和 RikkaHub 一样先给结论；请求行始终保留在原位。
const expandedSteps = ref(false)
const canCollapse = computed(() => contentSteps.value.length > 3)
const textOnly = computed(() => !finalText.value && contentSteps.value.length > 0 && contentSteps.value.every(step => step.type === 'text'))
// 折叠时只留最近两步和最新一条请求；展开后才按原位显示全部请求。
const visibleSteps = computed(() => {
  if (textOnly.value) return steps.value.filter(step => step.type === 'request' || step.type === 'compact')
  if (!canCollapse.value || expandedSteps.value) return steps.value
  const kept = new Set(contentSteps.value.slice(-2).map(step => step.key))
  const lastStatus = steps.value.findLast(step => step.type === 'request' || step.type === 'compact')
  return steps.value.filter(step => kept.has(step.key) || step === lastStatus)
})
const hiddenSteps = computed(() => contentSteps.value.length - visibleSteps.value.filter(step => step.type !== 'request').length)
const bubbleText = computed(() => finalText.value || (textOnly.value ? fallbackText.value : (!contentSteps.value.length ? fallbackText.value : '')))
const { text: bubbleContent, done: bubbleDone } = useSmoothText(bubbleText)

const error = computed(() => props.messages.findLast(message => message.error)?.error || '')

const defaultTarget = computed(() => [...props.messages].reverse().find(actionable) || null)
// 落点在已落盘的消息上时用那一条，否则退回默认目标；分支和回退用同一个目标。
const targetedMessage = computed(() => targeted(targetId.value) || defaultTarget.value)
const rollbackTarget = computed(() => targetedMessage.value)
const forkTarget = computed(() => targetedMessage.value)
const menuItems = computed(() => {
  const items = [{ value: 'copy', label: '复制消息', icon: 'copy', disabled: !content.value }]
  if (rollbackTarget.value && forkTarget.value) {
    items.push({ value: 'rollback', label: '回退到这条回复', icon: 'undo', disabled: props.running })
    items.push({ value: 'fork', label: '从这里分支', icon: 'branch', disabled: props.running })
  }
  return items
})

function onMenu(action) {
  if (action === 'copy') copyMessage(messageText(rollbackTarget.value))
  else if (action === 'rollback') emit('rollback', rollbackTarget.value)
  else if (action === 'fork') emit('fork', forkTarget.value)
}

// 复制只在本区域反馈，剪贴板工具不依赖页面。
async function copyMessage(text) { Notice.show(await copyText(text) ? '已复制' : '复制失败'); }

// 右键打开聚光：从落点解析目标消息，找不到时退回整轮默认目标（最后一条已落盘）。
function resolveTarget(event) {
  if (event?.target instanceof Element) targetId.value = event.target.closest('[data-message-id]')?.getAttribute('data-message-id') || targetId.value
  return targetId.value
}
// 聚光关闭或回退结束就清掉落点，下一次右键重新解析。
function clearTarget() { targetId.value = null; emit('close') }
</script>

<template>
  <div class="assistant-message rikka-message rikka-message--assistant">
    <MessageActions
      :items="menuItems"
      :target-id="rollbackTarget?.id || null"
      label="助手消息操作"
      :rollback-target="rollbackTarget"
      :rollback-preview="rollbackPreview"
      @request-open="resolveTarget"
      @close="clearTarget"
      @action="onMenu"
      @rollback-confirm="emit('rollback-confirm', $event)"
    >
      <div v-if="visibleSteps.length" class="cot-card">
        <button v-if="canCollapse" type="button" class="cot-fold" :class="{ 'is-open': expandedSteps }" :aria-expanded="expandedSteps" @click="expandedSteps = !expandedSteps">
          <Icon name="down" :size="14" />
          <span>{{ expandedSteps ? '收起过程' : `展开其余 ${hiddenSteps} 步` }}</span>
        </button>
        <div class="cot-steps">
          <template v-for="step in visibleSteps" :key="step.key">
            <RequestStatus v-if="step.type === 'request'" :data-message-id="step.messageId" :request="step.request" />
            <template v-else-if="step.type === 'compact'">
              <RequestStatus :data-message-id="step.messageId" :request="step.request" kind="compact" />
              <pre v-if="step.request.content || step.request.reasoning" v-auto-scroll class="compact-stream">{{ step.request.content || step.request.reasoning }}</pre>
            </template>
            <ReasoningStep
              v-else-if="step.type === 'reasoning'"
              :data-message-id="step.messageId"
              :reasoning="step.text"
              :streaming="step.streaming"
              :started-at="step.message.startedAt"
              :finished-at="step.message.finishedAt"
            />
            <div v-else-if="step.type === 'text'" :data-message-id="step.messageId" class="cot-step cot-step--text">
              <span class="cot-step__icon"><Icon name="chat" :size="16" /></span>
              <div class="cot-step__main">
                <div class="cot-step__body cot-step__body--text">
                  <Markdown smooth :content="step.text" compact />
                </div>
              </div>
            </div>
            <ToolCall
              v-else
              :data-message-id="step.messageId"
              :tool="step.tool"
              :session-id="sessionId"
            />
          </template>
        </div>
      </div>

      <div v-if="bubbleText" class="rikka-bubble rikka-bubble--assistant" :class="{ 'is-streaming': streaming }" :data-message-id="bubbleMessageId">
        <Markdown :content="bubbleContent" />
        <!-- 结束工具结果已经完整时，光标只是在等连接关闭，不该继续闪。 -->
        <span v-if="!bubbleDone && !finalText" class="stream-caret" aria-hidden="true"></span>
      </div>

      <p v-if="error" class="message__error" role="alert">{{ error }}</p>
    </MessageActions>
  </div>
</template>

<style lang="scss" src="../../styles/components/conversation/AssistantTurn.scss"></style>
