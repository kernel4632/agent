<!--
对话右侧快捷定位条：一轮一条刻度，用户短、助手长；不画竖线、不做滑块。
鼠标停留显示“你/回答”的消息前缀，点击或拖动跳转；轨道只覆盖对话滚动区。
调用示例：<ConversationRail :messages="session.messages" :scroll-root="conversationScroll" @jump="jumpToMessage" />。
-->
<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { groupMessageTurns } from '../../commands/history.js'

const props = defineProps({
  messages: { type: Array, default: () => [] },
  scrollRoot: { type: Object, default: null },
})
const emit = defineEmits(['jump'])

const track = ref(null)
const ratio = ref(0)
const dragging = ref(false)
const hoverIndex = ref(-1)
const viewport = ref({ top: '0px', height: '0px' })
let scrollParent = null
let observer = null
let frame = 0
let pendingIndex = -1
let viewportRetry = 0

// 一轮一条刻度：用户问题和助手回答都能定位，刻度长度由这一轮的文字量决定。
const nodes = computed(() => groupMessageTurns(props.messages)
  .filter(turn => !turn.messages[0].compact)
  .map(turn => {
    const text = turn.messages
      .map(message => String(message.displayContent ?? message.content ?? ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    const fallback = turn.messages[0].images?.length ? '图片消息' : '空消息'
    const prefix = text || fallback
    const attachments = turn.messages[0].attachments?.length ? ` · ${turn.messages[0].attachments.length} 个附件` : ''
    return {
      id: turn.messages[0].id,
      role: turn.role,
      length: prefix.length,
      title: `${turn.role === 'user' ? '你' : '回答'}：${prefix}${attachments}`.slice(0, 120),
    }
  }))

// 按这一轮相对最长消息的比例给宽度；短问题明显短，长回答接近满格。
const maxLength = computed(() => Math.max(1, ...nodes.value.map(node => node.length)))
const widthOf = node => 6 + Math.round(18 * Math.min(1, node.length / maxLength.value))

const activeIndex = computed(() => {
  if (!nodes.value.length) return -1
  return Math.min(nodes.value.length - 1, Math.max(0, Math.round(ratio.value * (nodes.value.length - 1))))
})
const activeNode = computed(() => nodes.value[activeIndex.value] || null)
const hoverNode = computed(() => nodes.value[hoverIndex.value] || null)
const ariaValue = computed(() => activeIndex.value + 1)

const positionOf = index => nodes.value.length <= 1 ? 0 : index / (nodes.value.length - 1) * 100
const clamp = value => Math.min(1, Math.max(0, value))

function syncFromScroll() {
  if (!scrollParent || dragging.value) return
  const max = scrollParent.scrollHeight - scrollParent.clientHeight
  ratio.value = max > 0 ? clamp(scrollParent.scrollTop / max) : 0
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
}

function ratioAt(event) {
  const rect = track.value?.getBoundingClientRect()
  if (!rect?.height) return 0
  return clamp((event.clientY - rect.top) / rect.height)
}

function queueJump(index) {
  if (!nodes.value.length || index < 0) return
  pendingIndex = Math.min(nodes.value.length - 1, index)
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    const node = nodes.value[pendingIndex]
    pendingIndex = -1
    if (node) emit('jump', node.id)
  })
}

function seekTo(event) {
  if (!nodes.value.length) return
  ratio.value = ratioAt(event)
  const index = activeIndex.value
  hoverIndex.value = index
  queueJump(index)
}

function pointerDown(event) {
  if (event.button !== undefined && event.button !== 0) return
  dragging.value = true
  track.value?.setPointerCapture?.(event.pointerId)
  event.preventDefault()
  seekTo(event)
}

function pointerMove(event) {
  if (!nodes.value.length) return
  hoverIndex.value = Math.min(nodes.value.length - 1, Math.max(0, Math.round(ratioAt(event) * (nodes.value.length - 1))))
  if (dragging.value) seekTo(event)
}

function pointerLeave() {
  if (!dragging.value) hoverIndex.value = -1
}

function pointerUp(event) {
  if (!dragging.value) return
  dragging.value = false
  track.value?.releasePointerCapture?.(event.pointerId)
  syncFromScroll()
}

function keydown(event) {
  if (!nodes.value.length || !['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return
  event.preventDefault()
  let index = activeIndex.value
  if (event.key === 'Home') index = 0
  else if (event.key === 'End') index = nodes.value.length - 1
  else if (event.key === 'ArrowUp' || event.key === 'PageUp') index -= 1
  else index += 1
  index = Math.min(nodes.value.length - 1, Math.max(0, index))
  ratio.value = positionOf(index) / 100
  hoverIndex.value = index
  queueJump(index)
}

onMounted(() => {
  // 滚动容器由页面传入；极端挂载顺序下 ref 还未展开时，用当前会话的滚动区兜底。
  scrollParent = props.scrollRoot?.nodeType === 1 ? props.scrollRoot : document.querySelector('.session-scroll')
  scrollParent?.addEventListener('scroll', syncFromScroll, { passive: true })
  observer = new ResizeObserver(onResize)
  if (scrollParent) observer.observe(scrollParent)
  window.addEventListener('resize', onResize)
  syncViewport()
  syncFromScroll()
  requestAnimationFrame(() => requestAnimationFrame(syncViewport))
  setTimeout(syncViewport, 120)
})

onBeforeUnmount(() => {
  scrollParent?.removeEventListener('scroll', syncFromScroll)
  observer?.disconnect()
  window.removeEventListener('resize', onResize)
  if (frame) cancelAnimationFrame(frame)
})
</script>

<template>
  <aside v-if="nodes.length > 1" class="conversation-rail" :class="{ 'is-dragging': dragging }" :style="viewport" aria-label="对话定位">
    <div
      ref="track"
      class="conversation-rail__track"
      role="slider"
      tabindex="0"
      aria-label="按消息定位"
      aria-orientation="vertical"
      :aria-valuemin="1"
      :aria-valuemax="nodes.length"
      :aria-valuenow="ariaValue"
      :aria-valuetext="activeNode?.title || ''"
      @pointerdown="pointerDown"
      @pointermove="pointerMove"
      @pointerleave="pointerLeave"
      @pointerup="pointerUp"
      @pointercancel="pointerUp"
      @keydown="keydown"
    >
      <span
        v-for="(node, index) in nodes" :key="node.id"
        class="conversation-rail__mark"
        :class="{ 'is-active': index === activeIndex, 'is-hover': index === hoverIndex }"
        :style="{ top: `${positionOf(index)}%`, width: `${widthOf(node)}px` }"
        :data-index="index"
        aria-hidden="true"
        @pointerenter="hoverIndex = index"
      ></span>
      <span v-if="hoverNode" class="conversation-rail__preview" :style="{ top: `${positionOf(hoverIndex)}%` }" aria-hidden="true">{{ hoverNode.title }}</span>
      <span class="conversation-rail__sr" v-if="activeNode">当前定位：{{ activeNode.title }}</span>
    </div>
  </aside>
</template>

<style scoped lang="scss" src="../../styles/components/conversation/ConversationRail.scss"></style>
