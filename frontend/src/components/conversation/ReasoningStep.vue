<!--
思考步骤：收起时只在标题行显示最后一句。点开后高度封顶。
流式且内容很长时只渲染定高纯文本，结束后再挂 Markdown，避免大段思考解析卡死和把页面顶来顶去。
调用示例：<ReasoningStep :reasoning="message.reasoning" :streaming="message.isStreaming" :started-at="message.startedAt" :finished-at="message.finishedAt" />
-->
<script setup>
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import Icon from '../../ui/Icon.vue'
import Markdown from '../../ui/Markdown.vue'

// 折叠按钮和内容用同一个 id 关联，读屏才知道按钮控制的是哪一块。
const contentId = `reasoning-${useId()}`

const props = defineProps({
  reasoning: { type: String, default: '' },
  streaming: Boolean,
  startedAt: { type: Number, default: 0 },
  finishedAt: { type: Number, default: 0 },
})

const expanded = ref(false)
const now = ref(Date.now())
const shown = ref(props.reasoning || '')
let timer = null
let frame = 0
// 超过这个长度还在流式输出时，不再每字重跑 Markdown。
const PLAIN_STREAM = 2500

const showContent = computed(() => expanded.value)
const streamingLarge = computed(() => props.streaming && shown.value.length >= PLAIN_STREAM)
const liveText = computed(() => shown.value.length > 6000 ? shown.value.slice(-6000) : shown.value)
const seconds = computed(() => {
  if (!props.startedAt) return 0
  return Math.max(0, ((props.finishedAt || now.value) - props.startedAt) / 1000)
})
const label = computed(() => {
  if (props.streaming && !props.reasoning) return '正在思考…'
  return props.startedAt ? `深度思考 ${seconds.value.toFixed(1)} 秒` : '深度思考'
})
// 只看末尾一小段，长思考不用整段扫一遍。
const tail = computed(() => {
  if (!shown.value || showContent.value) return ''
  const end = shown.value.slice(-160).replace(/\s+/g, ' ').trim()
  if (!end) return ''
  return shown.value.length > 72 ? `…${end.slice(-72)}` : end
})

function paint(value) {
  shown.value = value || ''
}

function toggle() {
  if (frame) { cancelAnimationFrame(frame); frame = 0 }
  paint(props.reasoning)
  expanded.value = !expanded.value
}

const vStick = {
  mounted: element => { element.scrollTop = element.scrollHeight },
  updated: element => { element.scrollTop = element.scrollHeight },
}

watch(() => props.reasoning, value => {
  const next = value || ''
  if (!props.streaming || next.length < PLAIN_STREAM) {
    if (frame) { cancelAnimationFrame(frame); frame = 0 }
    paint(next)
    return
  }
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    paint(props.reasoning)
  })
}, { immediate: true })

watch(() => props.streaming, streaming => {
  if (!streaming) {
    if (frame) { cancelAnimationFrame(frame); frame = 0 }
    paint(props.reasoning)
  }
  if (timer) { window.clearInterval(timer); timer = null }
  if (streaming) timer = window.setInterval(() => { now.value = Date.now() }, 250)
}, { immediate: true })

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
  if (frame) cancelAnimationFrame(frame)
})
</script>

<template>
  <div class="cot-step cot-step--reasoning">
    <span class="cot-step__icon"><Icon name="idea" :size="16" /></span>
    <button type="button" class="cot-step__head" :aria-expanded="showContent" :aria-controls="showContent ? contentId : undefined" @click="toggle">
      <span class="cot-step__label" :class="{ 'is-live': streaming }">{{ label }}</span>
      <span v-if="tail" class="cot-step__summary" :title="tail">{{ tail }}</span>
      <Icon name="down" :size="16" class="cot-step__caret" :class="{ 'is-open': showContent }" aria-hidden="true" />
    </button>
    <div v-if="showContent" :id="contentId" class="cot-step__body reasoning-body">
      <pre v-if="streamingLarge" v-stick class="reasoning-live">{{ liveText }}</pre>
      <Markdown v-else-if="shown.trim()" class="reasoning-markdown" :content="shown" compact />
      <p v-else class="reasoning-placeholder">正在整理思路…</p>
    </div>
  </div>
</template>

<style lang="scss" src="../../styles/components/conversation/ReasoningStep.scss"></style>
