<!--
一整轮助手回复：把自动接续产生的多条 assistant 消息合并成一条连续消息。
思考、工具和中间正文按发生顺序合成一张时间线卡片；完成任务/询问用户这类结束工具的结果才是正式回复，直接显示在卡片下方，不再套背景。
没有结束工具时（停止、报错、断网）才把已经流出的正文当临时回复。
右键或长按这一整轮，直接打开聚光引导（见 MessageActions）：框住落点所在的那条消息和它的工具，菜单卡片只给复制/回退/分支三个按钮；复制目标那一条的内容（stop 工具输出或正文），不展示预览。
调用示例：<AssistantTurn :messages="turn.messages" :session-id="session.id" :running="running" :rollback-target="..." :rollback-preview="..." @rollback="..." @fork="..." @rollback-confirm="..." />
-->
<script setup>
import { Notice } from "../../utils/notice.js"
import { copyText } from '../../utils/clipboard.js'

import { computed, nextTick, ref, watch } from 'vue'
import Icon from '../../ui/Icon.vue'
import Markdown from '../../ui/Markdown.vue'
import { useSmoothText } from '../../utils/smooth-text.js'
import { outputText, toolTitle } from "../../utils/tool.js"
import { isFinishedStopTool, isSavedMessage } from "../../features/turns.js"
import MessageActions from './MessageActions.vue'
import Fold from '../../ui/Fold.vue'
import RequestStatus from '../feedback/RequestStatus.vue'
import ReasoningStep from './ReasoningStep.vue'
import ToolCall from '../activity/ToolCall.vue'

const props = defineProps({
  messages: { type: Array, required: true },
  sessionId: { type: String, required: true },
  running: Boolean,
  active: Boolean,
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
const streaming = computed(() => props.messages.some(message => message.isStreaming))
// 一轮任务里“模型请求结束、工具还在执行、下一次请求尚未开始”不是整轮结束。
// 只要这仍然是当前会话的最后一轮且任务在跑，处理过程和思考就保持展开，
// 避免每次 tool-result/llm-finish 都收起再展开，形成高频闪烁。
const turnActive = computed(() => (streaming.value || props.active) && !finalText.value)

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
          streaming: turnActive.value && !sequence.slice(index + 1).some(step => step.type === 'reasoning'),
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
// 下一次模型请求开始时这个值增加；工具用它判断“下一次流式内容到了”。
const requestSerial = computed(() => steps.value.filter(step => step.type === 'request' || step.type === 'compact').length)
const textOnly = computed(() => !finalText.value && contentSteps.value.length > 0 && contentSteps.value.every(step => step.type === 'text'))
// 只有临时正文时把它留在树外的响应当中，避免和最终气泡重复；树里仍保留请求状态。
const treeSteps = computed(() => textOnly.value ? steps.value.filter(step => step.type === 'request' || step.type === 'compact') : steps.value)
// 整轮处理默认折叠；活动时自动展开。折叠状态只保留在本次会话的当前挂载里：
// 切换会话后重新挂载，历史轮次全部收起，正在执行的那一轮仍然展开。
const processTouched = ref(false)
const processOpen = ref(turnActive.value)
watch(turnActive, value => {
  if (!processTouched.value) processOpen.value = value
})
function toggleProcess() {
  processTouched.value = true
  processOpen.value = !processOpen.value
}
function summarizeSteps(steps) {
  const content = steps.filter(step => step.type !== 'request' && step.type !== 'compact')
  const reasoning = content.filter(step => step.type === 'reasoning').length
  const tools = content.filter(step => step.type === 'tool')
  if (!reasoning && !tools.length) return content.length ? `${content.length} 步` : '运行状态'
  const names = new Map()
  let waiting = 0
  for (const step of tools) {
    const name = toolTitle(step.tool)
    names.set(name, (names.get(name) || 0) + 1)
    if (step.tool?.status === 'waiting') waiting += 1
  }
  const pieces = []
  if (waiting) pieces.push(`${waiting} 个等待许可`)
  if (reasoning) pieces.push(`${reasoning} 次思考`)
  if (tools.length) pieces.push(`使用了 ${tools.length} 次工具：${[...names].map(([name, count]) => `${name} ${count} 次`).join('、')}`)
  return pieces.join(' · ')
}
function summarizeProcess(steps) {
  const requests = steps.filter(step => step.type === 'request').length
  const content = summarizeSteps(steps)
  const pieces = []
  if (requests) pieces.push(`${requests} 次模型请求`)
  if (content !== '运行状态') pieces.push(content)
  return pieces.join(' · ') || '运行状态'
}
const processSummary = computed(() => summarizeProcess(treeSteps.value))
// 要批准时把收起的处理过程整个展开，按钮滚进视野；高度不做动画，避免把时间线抽一下。
const needsDecision = tool => !!tool && (tool.status === 'waiting' || (tool.subagentSteps || []).some(needsDecision))
const isPendingStep = step => step.type === 'tool' && needsDecision(step.tool)
const approvalPending = computed(() => treeSteps.value.some(isPendingStep))
const processShown = computed(() => processOpen.value || approvalPending.value)
// 批准出现时展开，点完允许后保持展开，避免刚展开又收回去。
watch(approvalPending, pending => {
  if (pending) processOpen.value = true
}, { immediate: true })
const pendingKey = computed(() => treeSteps.value.filter(isPendingStep).map(step => step.tool?.id).filter(Boolean).join(','))
const turnEl = ref(null)
watch(pendingKey, value => {
  if (!value) return
  nextTick(() => {
    requestAnimationFrame(() => {
      turnEl.value?.querySelector('.approval')?.scrollIntoView({ block: 'center', inline: 'nearest' })
    })
  })
})

// 通用规则：
// 1. 助手正文永远留在折叠组外，保证一级能看到“说了什么”；
// 2. 请求是“下一次动作”的元数据，遇到正文先挂起，交给正文之后的第一组工具/思考；
// 3. 这一组把请求放在第一个工具上方，然后按原顺序展开思考/工具；
// 4. 组内保持请求→思考→工具的顺序；
// 5. 单个动作没有请求时直接显示；有请求的动作收进组里，保证请求和工具不分离。
const processSections = computed(() => {
  const sections = []
  let group = null
  // 当前模型请求会跨过正文，继续作为后续动作组的元数据；
  // 同一个请求可以在正文前后各出现一次，但绝不会落到别的请求下面。
  let currentRequests = []

  const flush = () => {
    if (!group) return
    const requests = group.steps.filter(step => step.type === 'request' || step.type === 'compact')
    const actions = group.steps.filter(step => step.type === 'reasoning' || step.type === 'tool')
    if (!actions.length || (actions.length === 1 && !requests.length)) {
      for (const step of group.steps) sections.push({ type: 'step', key: step.key, step })
    } else {
      sections.push({ ...group, summary: summarizeSteps(actions) })
    }
    group = null
  }

  for (const step of treeSteps.value) {
    if (step.type === 'text') {
      flush()
      sections.push({ type: 'step', key: step.key, step })
      // 正文后的动作只承接最后一个请求，不能把整轮历史请求重复带进每个组。
      currentRequests = currentRequests.slice(-1)
      continue
    }
    if (step.type === 'request' || step.type === 'compact') {
      // 连续请求/压缩都是时间线节点，不能互相覆盖；动作组开始时一起放到组头。
      currentRequests.push(step)
      if (group) group.steps.push(step)
      continue
    }
    if (!group) {
      group = { type: 'group', key: `group-${step.key}`, steps: [...currentRequests] }
    }
    group.steps.push(step)
  }
  flush()
  // 结尾只有请求、没有后续动作时，直接留在时间线上。
  for (const step of currentRequests) {
    if (!sections.some(section => section.type === 'step' && section.step === step)) {
      const inGroup = sections.some(section => section.type === 'group' && section.steps.includes(step))
      if (!inGroup) sections.push({ type: 'step', key: step.key, step })
    }
  }
  return sections
})

const groupStoreKey = `agent.process-groups:${props.sessionId}:${props.messages[0]?.id || 'turn'}`
const groupOpen = ref((() => {
  try { return JSON.parse(localStorage.getItem(groupStoreKey) || '{}') || {} } catch { return {} }
})())
const lastGroupKey = computed(() => processSections.value.filter(section => section.type === 'group').at(-1)?.key)
// 只有“还在动作中”的最后一组自动展开；助手一旦开始说正文，前面的工具组自动收起。
const lastStepType = computed(() => treeSteps.value.at(-1)?.type)
const activeGroupKey = computed(() => turnActive.value && lastStepType.value !== 'text' ? lastGroupKey.value : null)
const isGroupOpen = section => section.steps?.some(isPendingStep) || (groupOpen.value[section.key] ?? (section.key === activeGroupKey.value))
function toggleGroup(section) {
  groupOpen.value = { ...groupOpen.value, [section.key]: !isGroupOpen(section) }
  try { localStorage.setItem(groupStoreKey, JSON.stringify(groupOpen.value)) } catch {}
}
const bubbleText = computed(() => finalText.value || (textOnly.value ? fallbackText.value : (!contentSteps.value.length ? fallbackText.value : '')))
const { text: bubbleContent, done: bubbleDone } = useSmoothText(bubbleText)
// 结束工具的输出是一整段突然到达的正式回复；这里不再逐字追赶，
// 否则它会和处理过程折叠同时改变高度，形成连续闪烁。
const shownBubble = computed(() => finalText.value || bubbleContent.value)

const error = computed(() => props.messages.findLast(message => message.error)?.error || '')

const defaultTarget = computed(() => [...props.messages].reverse().find(actionable) || null)
// 落点在已落盘的消息上时用那一条，否则退回默认目标；分支和回退用同一个目标。
const targetedMessage = computed(() => targeted(targetId.value) || defaultTarget.value)
const rollbackTarget = computed(() => targetedMessage.value)
const forkTarget = computed(() => targetedMessage.value)
const menuItems = computed(() => {
  // 任务运行中仍显示回退/分支：分支由服务端直接做（只读快照），回退在确认后先停止任务再退。
  if (!rollbackTarget.value) return [{ value: 'copy', label: '复制消息', icon: 'copy', disabled: !content.value }]
  return [
    { value: 'copy', label: '复制消息', icon: 'copy', disabled: !content.value },
    { value: 'rollback', label: '回退到这条回复', icon: 'undo' },
    { value: 'fork', label: '从这里分支', icon: 'branch' },
  ]
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
  <div ref="turnEl" class="assistant-message rikka-message rikka-message--assistant">
    <MessageActions
      :items="menuItems"
      :target-id="rollbackTarget?.id || null"
      label="助手消息操作"
      :running="running"
      :rollback-target="rollbackTarget"
      :rollback-preview="rollbackPreview"
      @request-open="resolveTarget"
      @close="clearTarget"
      @action="onMenu"
      @rollback-confirm="emit('rollback-confirm', $event)"
    >
      <div v-if="treeSteps.length" class="cot-card process-fold">
        <button type="button" class="process-fold__head" :aria-expanded="processShown" @click="toggleProcess">
          <span class="process-fold__icon"><Icon name="assistant" :size="16" /></span>
          <span class="process-fold__title">处理过程</span>
          <em class="process-fold__summary" :title="processSummary">{{ processSummary }}</em>
          <Icon name="down" :size="15" class="process-fold__caret" :class="{ 'is-open': processShown }" aria-hidden="true" />
        </button>
        <Fold :open="processShown" :instant="approvalPending">
          <div class="process-fold__body context-sections">
            <template v-for="section in processSections" :key="section.key">
              <template v-if="section.type === 'step'">
                <RequestStatus v-if="section.step.type === 'request'" :data-message-id="section.step.messageId" :request="section.step.request" />
                <template v-else-if="section.step.type === 'compact'">
                  <RequestStatus :data-message-id="section.step.messageId" :request="section.step.request" kind="compact" />
                  <pre v-if="section.step.request.content || section.step.request.reasoning" v-auto-scroll class="compact-stream">{{ section.step.request.content || section.step.request.reasoning }}</pre>
                </template>
                <div v-else-if="section.step.type === 'text'" :data-message-id="section.step.messageId" class="cot-step cot-step--text">
                  <span class="cot-step__icon"><Icon name="chat" :size="16" /></span>
                  <div class="cot-step__main">
                    <div class="cot-step__body cot-step__body--text">
                      <Markdown smooth :content="section.step.text" compact />
                    </div>
                  </div>
                </div>
                <ReasoningStep
                  v-else-if="section.step.type === 'reasoning'"
                  :data-message-id="section.step.messageId"
                  :reasoning="section.step.text"
                  :streaming="section.step.streaming"
                  :started-at="section.step.message.startedAt"
                  :finished-at="section.step.message.finishedAt"
                />
                <ToolCall
                  v-else-if="section.step.type === 'tool'"
                  :data-message-id="section.step.messageId"
                  :tool="section.step.tool"
                  :session-id="sessionId"
                  :instant="!processShown"
                  :request-key="requestSerial"
                />
              </template>

              <div v-else class="context-group">
                <button type="button" class="context-group__head" :aria-expanded="isGroupOpen(section)" @click="toggleGroup(section)">
                  <span class="context-group__icon"><Icon name="layers" :size="16" /></span>
                  <span class="context-group__summary" :title="section.summary">{{ section.summary }}</span>
                  <Icon name="down" :size="14" class="context-group__caret" :class="{ 'is-open': isGroupOpen(section) }" aria-hidden="true" />
                </button>
                <Fold :open="isGroupOpen(section)" :instant="!processShown || section.steps.some(isPendingStep)">
                  <div class="context-group__body cot-steps">
                    <template v-for="step in section.steps" :key="step.key">
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
                      <ToolCall
                        v-else
                        :data-message-id="step.messageId"
                        :tool="step.tool"
                        :session-id="sessionId"
                        :instant="!processShown"
                        :request-key="requestSerial"
                      />
                    </template>
                  </div>
                </Fold>
              </div>
            </template>
          </div>
        </Fold>
      </div>
      <div v-if="bubbleText" class="rikka-bubble rikka-bubble--assistant" :class="{ 'is-streaming': streaming }" :data-message-id="bubbleMessageId">
        <Markdown :content="shownBubble" />
        <!-- 结束工具结果已经完整时，光标只是在等连接关闭，不该继续闪。 -->
        <span v-if="!bubbleDone && !finalText" class="stream-caret" aria-hidden="true"></span>
      </div>

      <p v-if="error" class="message__error" role="alert">{{ error }}</p>
    </MessageActions>
  </div>
</template>

<style lang="scss" src="../../styles/components/conversation/AssistantTurn.scss"></style>

