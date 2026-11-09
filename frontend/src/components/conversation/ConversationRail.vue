<!--
对话右侧快捷定位条：一轮一条刻度，用户短、助手长。
纵向按固定 10px 间距排列；轮次超过定位条高度后，定位条自己滚动，不把刻度压扁。
鼠标停留显示“你/回答”的消息前缀，点击或拖动跳转；轨道只覆盖对话滚动区。
调用示例：<ConversationRail :messages="session.messages" :scroll-root="conversationScroll" @jump="jumpToMessage" />。
-->
<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { groupMessageTurns, isFinishedStopTool } from "../../features/turns.js"
import { outputText } from "../../utils/tool.js"
import { AgentAPI } from "../../utils/api.js"
import { Notice } from "../../utils/notice.js"

const props = defineProps({
  messages: { type: Array, default: () => [] },
  sessionId: { type: String, default: '' },
  scrollRoot: { type: Object, default: null },
})
const emit = defineEmits(['jump'])

// 固定节距；轮次超出定位条高度后由定位条自己滚动，而不是压缩刻度。
const PITCH = 10
const INSET = 6
const MAX_FRAME = 420
const OVERSCAN = 4

const frame = ref(null)
const track = ref(null)
const ratio = ref(0)
const dragging = ref(false)
const hoverIndex = ref(-1)
const activeOverride = ref(null)
const visibleIndex = ref(-1)
const viewport = ref({ top: '0px', height: '0px' })
const frameHeight = ref(0)
const scrollTop = ref(0)

let scrollParent = null
let observer = null
let frameObserver = null
let frameTimer = 0
let pendingIndex = -1
let viewportRetry = 0
let pointerInside = false

function previewText(value) {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// 还没生成完的问答先按问题长度显示，回答完成后同一条刻度自然变长。
const userTextOf = turn => {
  const first = turn?.messages?.[0]
  if (!first || turn.role !== 'user') return ''
  const text = String(first.displayContent ?? first.content ?? '').replace(/\s+/g, ' ').trim()
  const fallback = first.images?.length ? '图片消息' : '空消息'
  const attachments = first.attachments?.length ? ` · ${first.attachments.length} 个附件` : ''
  return `${text || fallback}${attachments}`
}
const answerOf = turn => {
  if (!turn || turn.role !== 'assistant') return ''
  const stopMessage = [...turn.messages].reverse().find(message => (message.tools || []).some(isFinishedStopTool))
  const stopTool = (stopMessage?.tools || []).find(isFinishedStopTool)
  return String(outputText(stopTool) || '').replace(/\s+/g, ' ').trim()
}
// 定位条不能只依赖首屏窗口里的消息；否则加了历史分页后刻度会只剩最近几条。
// 大纲接口返回全会话轮次，滚动仍然只渲染可见刻度。
const outline = ref([])
let outlineTimer = 0
async function refreshOutline() {
  if (!props.sessionId) return
  try {
    const data = await AgentAPI.getSessionOutline(props.sessionId)
    outline.value = Array.isArray(data?.turns) ? data.turns : []
  } catch (error) {
    Notice.show(error.message)
  }
}
watch(() => props.sessionId, () => { void refreshOutline() }, { immediate: true })
watch(() => props.messages.length, () => {
  if (outlineTimer) window.clearTimeout(outlineTimer)
  outlineTimer = window.setTimeout(() => { void refreshOutline() }, 800)
})

const nodes = computed(() => {
  if (outline.value.length) {
    return outline.value.map(turn => {
      const prompt = previewText(turn.prompt)
      const response = previewText(turn.response)
      return {
        id: turn.id,
        index: turn.index,
        length: prompt.length + response.length,
        prompt,
        response,
        title: `${turn.role === 'user' ? '你' : '回答'}：${prompt || response}`.slice(0, 120),
      }
    })
  }
  const turns = groupMessageTurns(props.messages).filter(turn => !turn.messages[0].compact)
  const merged = []
  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index]
    if (turn.role === 'user') {
      const next = turns[index + 1]
      const prompt = previewText(userTextOf(turn))
      const response = previewText(answerOf(next))
      merged.push({
        id: turn.messages[0].id,
        index: props.messages.findIndex(message => message.id === turn.messages[0].id),
        length: prompt.length + response.length,
        prompt,
        response,
        title: `你：${prompt}`.slice(0, 120),
      })
      if (next?.role === 'assistant') index += 1
      continue
    }
    // 没有用户问题的助手回合（例如中断后续跑）也保留一条，跳转目标是这条回答。
    const response = previewText(answerOf(turn))
    if (!response) continue
    merged.push({
      id: turn.messages[0].id,
      index: props.messages.findIndex(message => message.id === turn.messages[0].id),
      length: response.length,
      prompt: '',
      response,
      title: `回答：${response}`.slice(0, 120),
    })
  }
  return merged
})
const messageIndexById = computed(() => {
  const map = new Map()
  props.messages.forEach((message, index) => map.set(message.id, index))
  return map
})
// 大纲里的 index 可能来自回退/压缩前，不能直接和当前 DOM 的消息下标比较；
// 用当前 messages 的 id 重新定位每个刻度。
const nodePositions = computed(() => nodes.value.map(node => {
  const current = messageIndexById.value.get(node.id)
  return Number.isInteger(current) ? current : Number(node.index)
}))

// 保留原定义：刻度宽度表示这一轮的文字量，短问题和长回答仍然可区分。
const maxLength = computed(() => Math.max(1, ...nodes.value.map(node => node.length)))
const widthOf = node => 6 + Math.round(18 * Math.min(1, node.length / maxLength.value))

const totalHeight = computed(() => nodes.value.length * PITCH + INSET * 2)
const maxFrameHeight = computed(() => Math.max(0, Math.min(MAX_FRAME, (parseFloat(viewport.value.height) || 0) - 64)))

const activeIndex = computed(() => {
  if (!nodes.value.length) return -1
  // 点击/键盘定位后先锁定被点的刻度；滚动过程的连续位置不能把蓝色提示带到别的消息。
  if (activeOverride.value !== null) return Math.min(nodes.value.length - 1, Math.max(0, activeOverride.value))
  if (visibleIndex.value >= 0) return visibleIndex.value
  return Math.min(nodes.value.length - 1, Math.max(0, Math.round(ratio.value * (nodes.value.length - 1))))
})
const activeNode = computed(() => nodes.value[activeIndex.value] || null)
const hoverNode = computed(() => nodes.value[hoverIndex.value] || null)
const ariaValue = computed(() => activeIndex.value + 1)

const markTop = index => INSET + index * PITCH
const scrollHeight = computed(() => Math.max(0, totalHeight.value - frameHeight.value))

const visibleMarks = computed(() => {
  const height = frameHeight.value || maxFrameHeight.value || 1
  const first = Math.max(0, Math.floor((scrollTop.value - INSET) / PITCH) - OVERSCAN)
  const last = Math.min(nodes.value.length, Math.ceil((scrollTop.value + height - INSET) / PITCH) + OVERSCAN)
  const indexes = []
  for (let index = first; index < last; index += 1) indexes.push(index)
  // 活动刻度和当前悬停刻度必须始终能显示，哪怕自动跟随暂时被指针暂停。
  for (const index of [activeIndex.value, hoverIndex.value]) {
    if (index >= 0 && index < nodes.value.length && !indexes.includes(index)) indexes.push(index)
  }
  indexes.sort((left, right) => left - right)
  return indexes.map(index => ({ index, node: nodes.value[index] }))
})

const previewTop = computed(() => {
  if (hoverIndex.value < 0) return 0
  const center = markTop(hoverIndex.value) + PITCH / 2 - scrollTop.value
  return Math.max(12, Math.min(Math.max(12, frameHeight.value - 12), center))
})

const canFadeTop = computed(() => scrollTop.value > 1)
const canFadeBottom = computed(() => scrollTop.value < scrollHeight.value - 1)

const clamp = value => Math.min(1, Math.max(0, value))

function syncFromScroll() {
  if (!scrollParent || dragging.value) return
  const max = scrollParent.scrollHeight - scrollParent.clientHeight
  ratio.value = max > 0 ? clamp(scrollParent.scrollTop / max) : 0
  // 高亮按“视口顶部实际是哪一轮 DOM”来定，不能拿等分比例近似：
  // 每轮高度差异巨大时，比例会把蓝色刻度带到完全不相邻的消息上。
  const rect = scrollParent.getBoundingClientRect()
  const row = [...scrollParent.querySelectorAll('[data-turn-id]')]
    .find(element => element.getBoundingClientRect().bottom > rect.top + 1)
  if (!row) {
    visibleIndex.value = -1
    return
  }
  const id = row.getAttribute('data-turn-id') || ''
  let index = nodes.value.findIndex(node => node.id === id)
  if (index < 0) {
    // 时间线轮的 id 可能是这一轮里某条助手/工具消息，大纲记的是用户消息；
    // 按当前完整历史里的消息下标，找到它之前最近的大纲轮次。
    const messageIndex = messageIndexById.value.get(id)
    if (Number.isInteger(messageIndex)) {
      for (let offset = 0; offset < nodes.value.length; offset += 1) {
        if (nodePositions.value[offset] <= messageIndex) index = offset
        else break
      }
    }
  }
  if (index < 0) {
    // 最后兜底：轮次里任何一条消息能对上大纲节点都算命中。
    index = nodes.value.findIndex(node => Boolean(row.querySelector(`[data-message-id="${CSS.escape(node.id)}"]`)))
  }
  visibleIndex.value = index
}

// 固定在视口右侧，但高度只覆盖对话滚动区；不跟着聊天列的内容宽度走。
function syncViewport() {
  if (!scrollParent) return
  const rect = scrollParent.getBoundingClientRect()
  if (rect.height <= 0 && viewportRetry < 30) {
    viewportRetry += 1
    requestAnimationFrame(syncViewport)
    return
  }
  viewportRetry = 0
  viewport.value = {
    top: `${Math.max(0, rect.top)}px`,
    height: `${Math.max(0, rect.height)}px`,
  }
}

function onResize() {
  syncViewport()
  syncFromScroll()
  followActive('auto')
}

function followActive(behavior = 'auto') {
  const element = track.value
  const height = frameHeight.value
  if (!element || !height || pointerInside || activeIndex.value < 0) return
  const center = markTop(activeIndex.value) + PITCH / 2
  const target = Math.max(0, Math.min(scrollHeight.value, center - height / 2))
  if (Math.abs(element.scrollTop - target) > 1) element.scrollTo({ top: target, behavior })
}

function onRailScroll(event) {
  scrollTop.value = event.currentTarget.scrollTop
}

// 定位条在会话出现第二轮后才挂载，不能只在 onMounted 时观察一次；否则 frameHeight
// 永远是 0，预览会被夹到顶部，自动跟随也会失效。
function observeFrame(element) {
  frameObserver?.disconnect()
  if (!element) {
    frameHeight.value = 0
    return
  }
  frameObserver?.observe(element)
  frameHeight.value = Math.round(element.getBoundingClientRect().height)
}

function indexAt(event) {
  const rect = track.value?.getBoundingClientRect()
  if (!rect?.height || !nodes.value.length) return -1
  const y = event.clientY - rect.top + (track.value?.scrollTop || 0) - INSET - PITCH / 2
  return Math.min(nodes.value.length - 1, Math.max(0, Math.round(y / PITCH)))
}

function selectIndex(index) {
  if (!nodes.value.length || index < 0) return
  const clamped = Math.min(nodes.value.length - 1, index)
  activeOverride.value = clamped
  ratio.value = nodes.value.length <= 1 ? 0 : clamped / (nodes.value.length - 1)
  hoverIndex.value = clamped
  pendingIndex = clamped
  if (frameTimer) return
  frameTimer = requestAnimationFrame(() => {
    frameTimer = 0
    const node = nodes.value[pendingIndex]
    pendingIndex = -1
    if (node) emit('jump', node)
  })
}

function seekFromPointer(event) {
  const index = indexAt(event)
  if (index >= 0) selectIndex(index)
}

function pointerDown(event) {
  if (event.button !== undefined && event.button !== 0) return
  dragging.value = true
  track.value?.setPointerCapture?.(event.pointerId)
  event.preventDefault()
  seekFromPointer(event)
}

function pointerMove(event) {
  if (dragging.value) seekFromPointer(event)
}

function pointerUp(event) {
  if (!dragging.value) return
  dragging.value = false
  track.value?.releasePointerCapture?.(event.pointerId)
  syncFromScroll()
}

function onRailEnter() {
  pointerInside = true
}

function onRailLeave() {
  pointerInside = false
  hoverIndex.value = -1
}

// 用户自己滚动时重新交给滚动比例决定蓝色位置。
function releaseActive() {
  activeOverride.value = null
}

function keydown(event) {
  if (!nodes.value.length || !['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return
  event.preventDefault()
  let index = activeIndex.value
  if (event.key === 'Home') index = 0
  else if (event.key === 'End') index = nodes.value.length - 1
  else if (event.key === 'ArrowUp' || event.key === 'PageUp') index -= 1
  else index += 1
  selectIndex(Math.min(nodes.value.length - 1, Math.max(0, index)))
}

watch([activeIndex, () => nodes.value.length, frameHeight], () => followActive())
watch(() => nodes.value.length, () => syncFromScroll())
watch(frame, element => observeFrame(element), { flush: 'post' })
watch(() => props.messages, () => nextTick(() => {
  syncViewport()
  followActive('auto')
}), { deep: false })

onMounted(() => {
  // 滚动容器由页面传入；极端挂载顺序下 ref 还未展开时，用当前会话的滚动区兜底。
  scrollParent = props.scrollRoot?.nodeType === 1 ? props.scrollRoot : document.querySelector('.session-scroll')
  scrollParent?.addEventListener('scroll', syncFromScroll, { passive: true })
  scrollParent?.addEventListener('wheel', releaseActive, { passive: true })
  scrollParent?.addEventListener('touchstart', releaseActive, { passive: true })
  observer = new ResizeObserver(onResize)
  if (scrollParent) observer.observe(scrollParent)
  frameObserver = new ResizeObserver(([entry]) => {
    if (!entry) return
    frameHeight.value = Math.round(entry.contentRect.height)
  })
  observeFrame(frame.value)
  window.addEventListener('resize', onResize)
  syncViewport()
  syncFromScroll()
  requestAnimationFrame(() => requestAnimationFrame(() => {
    syncViewport()
    followActive('auto')
  }))
})

onBeforeUnmount(() => {
  if (outlineTimer) window.clearTimeout(outlineTimer)
  scrollParent?.removeEventListener('scroll', syncFromScroll)
  scrollParent?.removeEventListener('wheel', releaseActive)
  scrollParent?.removeEventListener('touchstart', releaseActive)
  observer?.disconnect()
  frameObserver?.disconnect()
  window.removeEventListener('resize', onResize)
  if (frameTimer) cancelAnimationFrame(frameTimer)
})
</script>

<template>
  <aside v-if="nodes.length > 1 && maxFrameHeight > 0" class="conversation-rail" :class="{ 'is-dragging': dragging }" :style="viewport" aria-label="对话定位">
    <div ref="frame" class="conversation-rail__frame" :style="{ maxHeight: `${maxFrameHeight}px` }" @pointerenter="onRailEnter" @pointerleave="onRailLeave">
      <div
        ref="track"
        class="conversation-rail__scroller"
        :class="{ 'is-fade-top': canFadeTop, 'is-fade-bottom': canFadeBottom }"
        role="slider"
        tabindex="0"
        aria-label="按消息定位"
        aria-orientation="vertical"
        :aria-valuemin="1"
        :aria-valuemax="nodes.length"
        :aria-valuenow="ariaValue"
        :aria-valuetext="activeNode?.title || ''"
        @scroll="onRailScroll"
        @pointerdown="pointerDown"
        @pointermove="pointerMove"
        @pointerup="pointerUp"
        @pointercancel="pointerUp"
        @keydown="keydown"
      >
        <div class="conversation-rail__marks" :style="{ height: `${totalHeight}px` }">
          <span
            v-for="item in visibleMarks"
            :key="item.node.id"
            class="conversation-rail__mark"
            :class="{ 'is-active': item.index === activeIndex, 'is-hover': item.index === hoverIndex }"
            :style="{ top: `${markTop(item.index)}px`, width: `${widthOf(item.node)}px` }"
            :data-index="item.index"
            aria-hidden="true"
            @pointerenter="hoverIndex = item.index"
          ></span>
        </div>
      </div>
      <span v-if="hoverNode" class="conversation-rail__preview" :style="{ top: `${previewTop}px` }" aria-hidden="true">
        <span v-if="hoverNode.prompt" class="conversation-rail__preview-prompt">{{ hoverNode.prompt }}</span>
        <span v-if="hoverNode.response" class="conversation-rail__preview-response">{{ hoverNode.response }}</span>
      </span>
      <span class="conversation-rail__sr" v-if="activeNode">当前定位：{{ activeNode.title }}</span>
    </div>
  </aside>
</template>

<style scoped lang="scss" src="../../styles/components/conversation/ConversationRail.scss"></style>
