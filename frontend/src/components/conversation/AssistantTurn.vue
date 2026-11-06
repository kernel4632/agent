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

import { computed, ref, watch } from 'vue'
import Icon from '../../ui/Icon.vue'
import Markdown from '../../ui/Markdown.vue'
import { useSmoothText } from '../../utils/smooth-text.js'
import { outputText } from '../../commands/tool.js'
import { isFinishedStopTool } from '../../commands/history.js'
import { isSavedMessage } from '../../commands/history.js'
import MessageActions from './MessageActions.vue'
import ProcessTree from './ProcessTree.vue'

const props = defineProps({
  messages: { type: Array, required: true },
  sessionId: { type: String, required: true },
  running: Boolean,
  active: Boolean,                                    // 当前正在处理的最后一轮；旧轮次不应因为会话仍在跑而展开
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
const activeTurn = computed(() => streaming.value || props.active)

// 整轮一棵树：一级只保留“处理过程”入口，最终结束回复始终在树外。
// 运行中默认展开到最下层；这一轮完成时自动折叠；用户手动展开/收起按会话和这一轮记住。
const processKey = `agent.process-tree:${props.sessionId}:${props.messages[0]?.id || 'turn'}`
function readProcessOpen() {
  try {
    return localStorage.getItem(processKey) === 'open'
  } catch {
    return false
  }
}
function writeProcessOpen(value) {
  try { localStorage.setItem(processKey, value ? 'open' : 'closed') } catch {}
}
const processOpen = ref(activeTurn.value || readProcessOpen())
function toggleProcess() {
  processOpen.value = !processOpen.value
  writeProcessOpen(processOpen.value)
}

// 二级“工具与思考”聚类：思考、工具和子智能体都收在这里，正常说话留在外面。
const groupKey = `${processKey}:group`
function readGroupOpen() {
  try {
    return localStorage.getItem(groupKey) === 'open'
  } catch {
    return false
  }
}
function writeGroupOpen(value) {
  try { localStorage.setItem(groupKey, value ? 'open' : 'closed') } catch {}
}
const groupOpen = ref(activeTurn.value || readGroupOpen())
function toggleGroup() {
  groupOpen.value = !groupOpen.value
  writeGroupOpen(groupOpen.value)
}
watch(activeTurn, (value, previous) => {
  if (value) {
    processOpen.value = true
    groupOpen.value = true
  } else if (previous) {
    processOpen.value = false
    groupOpen.value = false
    writeProcessOpen(false)
    writeGroupOpen(false)
  }
})

const textOnly = computed(() => !finalText.value && contentSteps.value.length > 0 && contentSteps.value.every(step => step.type === 'text'))
// 只有临时正文时把它留在树外的响应当中，避免和最终气泡重复；树里仍保留请求状态。
const treeSteps = computed(() => textOnly.value ? steps.value.filter(step => step.type === 'request' || step.type === 'compact') : steps.value)
// 一级正文/请求留在外面；不管中间夹了多少句话，工具与思考始终收进同一个二级组。
// 组放在第一次出现工具/思考的位置，组前后的正文保持前后顺序。
const processSections = computed(() => {
  const directs = []
  const tools = []
  let insertAt = 0
  for (const step of treeSteps.value) {
    if (step.type === 'reasoning' || step.type === 'tool') {
      if (!tools.length) insertAt = directs.length
      tools.push(step)
    } else {
      directs.push({ type: 'step', key: step.key, step })
    }
  }
  if (!tools.length) return directs
  const group = { type: 'group', key: 'group-tools', steps: tools }
  return [...directs.slice(0, insertAt), group, ...directs.slice(insertAt)]
})
const treeContentSteps = computed(() => treeSteps.value.filter(step => step.type !== 'request' && step.type !== 'compact'))
const bubbleText = computed(() => finalText.value || (textOnly.value ? fallbackText.value : (!contentSteps.value.length ? fallbackText.value : '')))
const { text: bubbleContent, done: bubbleDone } = useSmoothText(bubbleText)

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
  <div class="assistant-message rikka-message rikka-message--assistant">
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
      <div v-if="treeSteps.length" class="cot-card process-tree" :class="{ 'is-open': processOpen }">
        <button type="button" class="process-tree__head" :aria-expanded="processOpen" @click="toggleProcess">
          <span class="process-tree__icon"><Icon name="layers" :size="15" /></span>
          <span class="process-tree__title">处理过程</span>
          <em>{{ treeContentSteps.length ? `${treeContentSteps.length} 步` : '运行状态' }}</em>
          <span v-if="activeTurn" class="process-tree__live">进行中</span>
          <Icon name="down" :size="15" class="process-tree__caret" :class="{ 'is-open': processOpen }" aria-hidden="true" />
        </button>
        <ProcessTree
          v-if="processOpen"
          :sections="processSections"
          :group-open="groupOpen"
          :session-id="sessionId"
          @toggle-group="toggleGroup"
        />
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
