<!--
一整轮助手回复：把自动接续产生的多条 assistant 消息合并成一条连续消息。
思考、工具和中间正文按发生顺序合成一张时间线卡片；完成任务/询问用户这类结束工具的结果才是正式回复，直接显示在卡片下方，不再套背景。
没有结束工具时（停止、报错、断网）才把已经流出的正文当临时回复。
每轮按模型请求切成步骤：思考和工具属于步骤内的内容；操作由 Timeline 的全局浮层承载。
右键和长按完全交还浏览器，全局浮层根据 data-step-* 找到当前步骤。
调用示例：<AssistantTurn :messages="turn.messages" :session-id="session.id" :active="active" />
-->
<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Icon from '../../ui/Icon.vue'
import Markdown from '../../ui/Markdown.vue'
import { store } from '../../store.js'
import { useSmoothText } from '../../utils/smooth-text.js'
import { outputText, toolTitle } from "../../utils/tool.js"
import { isFinishedStopTool, isSavedMessage } from "../../features/turns.js"
import Fold from '../../ui/Fold.vue'
import RequestStatus from '../feedback/RequestStatus.vue'
import ReasoningStep from './ReasoningStep.vue'
import ToolCall from '../activity/ToolCall.vue'

const props = defineProps({
  messages: { type: Array, required: true },
  sessionId: { type: String, required: true },
  active: Boolean,
})

// 步骤操作由 Timeline 的全局浮层读取 data-cut-*，这里不再渲染每步窄条。
const savedTarget = message => isSavedMessage(message) ? message : null
// 正文/工具行自己带精确切口；没有 partIndex 的旧历史仍退回整条消息操作。
const cutAttrs = step => step.partIndex === undefined ? {} : {
  'data-cut-row': '',
  'data-cut-message-id': step.messageId,
  'data-cut-part-index': step.partIndex,
  'data-cut-kind': step.type,
  'data-cut-label': step.type === 'tool' ? '工具操作' : '回复操作',
}

// 压缩预览滚动到最新一行：内容一直在追加，停在顶部就看不到模型正在写什么。
const vAutoScroll = {
  mounted: element => { element.scrollTop = element.scrollHeight },
  updated: element => { element.scrollTop = element.scrollHeight },
}

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
// 正式气泡的归属：它来自带结束工具的那条消息；没有结束工具时（textOnly）
// 气泡显示的是最后一条消息流出的正文，回退聚光也按这条框住它。
const finalMessage = computed(() => [...props.messages].reverse().find(message => (message.tools || []).some(isFinishedStopTool)) || null)
const bubbleTarget = computed(() => savedTarget(finalMessage.value || props.messages.at(-1)))
// 最终气泡由结束工具产生；精确回退从该 tool-call 的原始 content 位置切开。
const bubblePartIndex = computed(() => {
  const message = finalMessage.value
  const tool = message?.tools?.find(isFinishedStopTool)
  if (!tool) return undefined
  return message.steps?.find(step => step.type === 'tool' && step.toolId === tool.id)?.partIndex
})
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
          ...(String(message.reasoning || '').trim() ? [{ type: 'reasoning', text: message.reasoning }] : []),
          ...(message.content ? [{ type: 'text', text: message.content }] : []),
          ...(message.tools || []).map(tool => ({ type: 'tool', toolId: tool.id })),
        ]
    sequence.forEach((entry, index) => {
      if (entry.type === 'reasoning' && String(entry.text || '').trim()) {
        list.push({
          key: `${message.id}-reasoning-${index}`,
          type: 'reasoning',
          text: entry.text,
          message,
          messageId: message.id,
          // 思考的扫光和展开只跟随这条消息自己的流，不跟随整轮。
          // 整轮还在跑不等于这条旧思考还在输出。
          streaming: message.isStreaming && !sequence.slice(index + 1).some(step => step.type === 'reasoning'),
        })
      } else if (entry.type === 'text') {
        const text = String(entry.text || '').trim()
        if (text && text !== finalText.value.trim()) list.push({ key: `${message.id}-text-${index}`, type: 'text', text: entry.text, messageId: message.id, partIndex: entry.partIndex })
      } else if (entry.type === 'tool') {
        const tool = (message.tools || []).find(item => item.id === entry.toolId)
        if (tool && !isFinishedStopTool(tool)) list.push({ key: tool.id || `${message.id}-tool-${index}`, type: 'tool', tool, messageId: message.id, partIndex: entry.partIndex })
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
// 全会话的流式序号：下一段正文/思考可能落在另一条 assistant 消息里，
// 但工具只需要知道“模型又出字了”，所以用会话级计数而不是本组 steps 的字符数。
const streamSerial = computed(() => Number(store.sessions[props.sessionId]?.streamRevision || 0))
// 并行工具可能同时没有结束：所有运行/等待/组装中的工具都算活动，
// 已完成的工具才退出活动集并开始自动收起。
const toolSteps = computed(() => steps.value.filter(step => step.type === 'tool'))
const activeToolKeys = computed(() => new Set(
  toolSteps.value
    .filter(step => step.tool?.assembling || ['running', 'waiting'].includes(step.tool?.status))
    .map(step => step.key),
))
const isActiveTool = key => activeToolKeys.value.has(key)
const isRunningToolStep = step => step.type === 'tool'
  && (step.tool?.assembling || ['running', 'waiting'].includes(step.tool?.status))
const toolIndexByKey = computed(() => new Map(toolSteps.value.map((step, index) => [step.key, index])))
const textOnly = computed(() => !finalText.value && contentSteps.value.length > 0 && contentSteps.value.every(step => step.type === 'text'))
// 只有临时正文时把它留在树外的响应当中，避免和最终气泡重复；树里仍保留请求状态。
const treeSteps = computed(() => textOnly.value ? steps.value.filter(step => step.type === 'request' || step.type === 'compact') : steps.value)
// 整轮处理默认折叠；活动时自动展开。折叠状态只保留在本次会话的当前挂载里：
// 切换会话后重新挂载，历史轮次全部收起，正在执行的那一轮仍然展开。
const processTouched = ref(false)
const processOpen = ref(turnActive.value || steps.value.some(step => step.type === 'compact' && step.request?.status === 'running'))
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
const isRunningRequest = step => step.type === 'request' && step.request?.status === 'running'
const approvalPending = computed(() => treeSteps.value.some(isPendingStep))
const processShown = computed(() => processOpen.value || approvalPending.value)
// 外层处理过程收起时，内层不能先 instant 清空高度：否则外层卡片还占着
// 旧高度，里面已经空了。先保持当前分组/工具展开，让外层 Fold 带着内容收完。
const processClosing = ref(false)
let processCloseTimer = 0
watch(processShown, (open, previous) => {
  if (open) {
    processClosing.value = false
    clearTimeout(processCloseTimer)
    return
  }
  if (!previous) return
  processClosing.value = true
  clearTimeout(processCloseTimer)
  processCloseTimer = window.setTimeout(() => {
    processClosing.value = false
  }, 700)
})
onBeforeUnmount(() => clearTimeout(processCloseTimer))
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
const processSections = computed(() => {  const sections = []
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

// 一段连续的工具/思考动作合并成一个折叠组；只有助手正文才把动作组切开。
const stepBlocks = computed(() => {
  const blocks = []
  let current = null
  for (const section of processSections.value) {
    if (!current || section.type === 'group') {
      current = { key: section.key, sections: [] }
      blocks.push(current)
    }
    current.sections.push(section)
  }
  return blocks.map(block => {
    const steps = block.sections.flatMap(section => section.type === 'group' ? section.steps : [section.step])
    const messages = []
    const seen = new Set()
    for (const step of steps) {
      // request/text 步骤只带 messageId，不一定挂 message 对象；从本轮消息里补齐。
      const message = step.message || props.messages.find(item => item.id === step.messageId)
      if (!message || seen.has(message.id)) continue
      seen.add(message.id)
      messages.push(message)
    }
    return {
      ...block,
      messages,
      rollbackTarget: savedTarget(messages[0]) || null,
      forkTarget: savedTarget(messages.at(-1)) || null,
    }
  })
})

const groupStoreKey = `agent.process-groups:${props.sessionId}:${props.messages[0]?.id || 'turn'}`
const groupOpen = ref((() => {
  try { return JSON.parse(localStorage.getItem(groupStoreKey) || '{}') || {} } catch { return {} }
})())
const lastGroupKey = computed(() => processSections.value.filter(section => section.type === 'group').at(-1)?.key)
// 只有“还在动作中”的最后一组自动展开；助手一旦开始说正文，前面的工具组自动收起。
// 组里还有运行中的工具时不收，避免并行工具被下一条流式输出折叠。
const lastStepType = computed(() => treeSteps.value.at(-1)?.type)
const activeGroupKey = computed(() => (turnActive.value || processClosing.value) && lastStepType.value !== 'text' ? lastGroupKey.value : null)
const isGroupOpen = section => section.steps?.some(isPendingStep) || section.steps?.some(isRunningToolStep) || (section.steps?.some(isRunningRequest) && section.key === lastGroupKey.value && lastStepType.value !== 'text') || (groupOpen.value[section.key] ?? (section.key === activeGroupKey.value))
function toggleGroup(section) {
  groupOpen.value = { ...groupOpen.value, [section.key]: !isGroupOpen(section) }
  try { localStorage.setItem(groupStoreKey, JSON.stringify(groupOpen.value)) } catch {}
}
const bubbleText = computed(() => {
  // 本地精确回退后，结束工具已从这条消息里移除；不要再把旧正文当成最终回复。
  if (props.messages.some(message => message.rollbackCut)) return ''
  return finalText.value || (textOnly.value ? fallbackText.value : (!contentSteps.value.length ? fallbackText.value : ''))
})
const { text: bubbleContent, done: bubbleDone } = useSmoothText(bubbleText)
// 结束工具的输出是一整段突然到达的正式回复；这里不再逐字追赶，
// 否则它会和处理过程折叠同时改变高度，形成连续闪烁。
const shownBubble = computed(() => finalText.value || bubbleContent.value)

const error = computed(() => props.messages.findLast(message => message.error)?.error || '')
const defaultTarget = computed(() => [...props.messages].reverse().find(savedTarget) || null)
</script>

<template>
  <div ref="turnEl" class="assistant-message rikka-message rikka-message--assistant">
      <div v-if="treeSteps.length" class="cot-card process-fold">
        <button type="button" class="process-fold__head" :aria-expanded="processShown" @click="toggleProcess">
          <span class="process-fold__icon"><Icon name="assistant" :size="16" /></span>
          <span class="process-fold__title">处理过程</span>
          <em class="process-fold__summary" :title="processSummary">{{ processSummary }}</em>
          <Icon name="down" :size="15" class="process-fold__caret" :class="{ 'is-open': processShown }" aria-hidden="true" />
        </button>
        <Fold :open="processShown" :instant="approvalPending">
          <div class="process-fold__body context-sections">
            <div
              v-for="block in stepBlocks"
              :key="block.key"
              class="assistant-step"
              :data-step-key="block.key"
              :data-step-rollback="block.rollbackTarget?.id || ''"
              :data-step-fork="block.forkTarget?.id || ''"
              data-step-label="步骤操作"
            >
              <div class="assistant-step__body">
            <template v-for="section in block.sections" :key="section.key">
              <template v-if="section.type === 'step'">
                <RequestStatus v-if="section.step.type === 'request'" :data-message-id="section.step.messageId" :request="section.step.request" />
                <template v-else-if="section.step.type === 'compact'">
                  <RequestStatus :data-message-id="section.step.messageId" :request="section.step.request" kind="compact" />
                  <pre v-if="section.step.request.content || section.step.request.reasoning" v-auto-scroll class="compact-stream">{{ section.step.request.content || section.step.request.reasoning }}</pre>
                </template>
                <div v-else-if="section.step.type === 'text'" v-bind="cutAttrs(section.step)" :data-message-id="section.step.messageId" class="cot-step cot-step--text">
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
                  v-bind="cutAttrs(section.step)"
                  :data-message-id="section.step.messageId"
                  :tool="section.step.tool"
                  :session-id="sessionId"
                  :instant="approvalPending"
                  :stream-key="streamSerial"
                  :active="isActiveTool(section.step.key)"
                  :tool-index="toolIndexByKey.get(section.step.key) ?? 0"
                />
              </template>

              <div v-else class="context-group">
                <button type="button" class="context-group__head" :aria-expanded="isGroupOpen(section)" @click="toggleGroup(section)">
                  <span class="context-group__icon"><Icon name="layers" :size="16" /></span>
                  <span class="context-group__summary" :title="section.summary">{{ section.summary }}</span>
                  <Icon name="down" :size="14" class="context-group__caret" :class="{ 'is-open': isGroupOpen(section) }" aria-hidden="true" />
                </button>
                <Fold :open="isGroupOpen(section)" :instant="section.steps.some(isPendingStep)">
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
                        v-bind="cutAttrs(step)"
                        :data-message-id="step.messageId"
                        :tool="step.tool"
                        :session-id="sessionId"
                        :instant="approvalPending"
                        :stream-key="streamSerial"
                        :active="isActiveTool(step.key)"
                        :tool-index="toolIndexByKey.get(step.key) ?? 0"
                      />
                    </template>
                  </div>
                </Fold>
              </div>
            </template>
              </div>
            </div>
          </div>
        </Fold>
      </div>
      <div
        v-if="bubbleText"
        class="assistant-step assistant-step--response"
        data-step-key="response"
        :data-step-rollback="bubbleTarget?.id || ''"
        :data-step-fork="bubbleTarget?.id || ''"
        data-step-label="回复操作"
        v-bind="bubblePartIndex === undefined ? {} : {
          'data-cut-row': '',
          'data-cut-message-id': bubbleTarget?.id || '',
          'data-cut-part-index': bubblePartIndex,
          'data-cut-kind': 'response',
          'data-cut-label': '回复操作',
        }"
      >
        <div class="assistant-step__body">
          <div class="rikka-bubble rikka-bubble--assistant" :class="{ 'is-streaming': streaming }" :data-message-id="bubbleMessageId">
            <Markdown :content="shownBubble" />
            <!-- 结束工具结果已经完整时，光标只是在等连接关闭，不该继续闪。 -->
            <span v-if="!bubbleDone && !finalText" class="stream-caret" aria-hidden="true"></span>
          </div>
          <p v-if="error" class="message__error" role="alert">{{ error }}</p>
        </div>
      </div>
      <p v-else-if="error" class="message__error" role="alert">{{ error }}</p>
  </div>
</template>

<style lang="scss" src="../../styles/components/conversation/AssistantTurn.scss"></style>


