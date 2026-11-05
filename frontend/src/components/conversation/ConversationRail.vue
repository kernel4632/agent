<!--
对话右侧快捷定位条：以用户消息为单位显示刻度，点击或拖动定位到对应消息。
轨道只覆盖当前滚动容器，不改变消息宽度，也不替代浏览器滚动条。
调用示例：<ConversationRail :messages="session.messages" :scroll-root="conversationScroll" @jump="jumpToMessage" />。
-->
<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  messages: { type: Array, default: () => [] },
  scrollRoot: { type: Object, default: null },
})
const emit = defineEmits(['jump'])

const track = ref(null)
const ratio = ref(0)
const dragging = ref(false)
const hoverIndex = ref(-1)
let scrollParent = null
let observer = null
let frame = 0
let pendingIndex = -1

const nodes = computed(() => props.messages
  .filter(message => message.role === 'user' && !message.compact && message.id)
  .map(message => {
    const raw = String(message.displayContent ?? message.content ?? '').replace(/\s+/g, ' ').trim()
    const attachments = message.attachments?.length ? ` · ${message.attachments.length} 个附件` : ''
    const images = message.images?.length ? ` · ${message.images.length} 张图片` : ''
    return {
      id: message.id,
      title: `${raw || '图片消息'}${attachments || images}`.slice(0, 120),
    }
  }))

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
  scrollParent = props.scrollRoot
  scrollParent?.addEventListener('scroll', syncFromScroll, { passive: true })
  observer = new ResizeObserver(syncFromScroll)
  if (scrollParent) observer.observe(scrollParent)
  syncFromScroll()
})

onBeforeUnmount(() => {
  scrollParent?.removeEventListener('scroll', syncFromScroll)
  observer?.disconnect()
  if (frame) cancelAnimationFrame(frame)
})
</script>

<template>
  <aside v-if="nodes.length > 1" class="conversation-rail" :class="{ 'is-dragging': dragging }" aria-label="对话定位">
    <div
      ref="track"
      class="conversation-rail__track"
      role="slider"
      tabindex="0"
      aria-label="按用户消息定位"
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
        :style="{ top: `${positionOf(index)}%` }"
        :data-index="index"
        aria-hidden="true"
        @pointerenter="hoverIndex = index"
      ></span>
      <span class="conversation-rail__thumb" :style="{ top: `${ratio * 100}%` }" aria-hidden="true"></span>
      <span v-if="hoverNode" class="conversation-rail__preview" :style="{ top: `${positionOf(hoverIndex)}%` }" aria-hidden="true">{{ hoverNode.title }}</span>
      <span class="conversation-rail__sr" v-if="activeNode">当前定位：{{ activeNode.title }}</span>
    </div>
  </aside>
</template>

<style scoped lang="scss" src="../../styles/components/conversation/ConversationRail.scss"></style>
