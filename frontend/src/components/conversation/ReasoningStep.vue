<!--
思考步骤：流式时只在标题行显示最新一句，不把内容框打开再关上。
点标题才挂上完整 Markdown。高速连续思考时页面高度保持一行，避免抽搐。
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
let timer = null

const showContent = computed(() => expanded.value)
const seconds = computed(() => {
  if (!props.startedAt) return 0
  return Math.max(0, ((props.finishedAt || now.value) - props.startedAt) / 1000)
})
const label = computed(() => {
  if (props.streaming && !props.reasoning) return '正在思考…'
  return props.startedAt ? `深度思考 ${seconds.value.toFixed(1)} 秒` : '深度思考'
})
// 收起时只留最后一句，不挂 Markdown，也不做高度动画。
const tail = computed(() => {
  const text = String(props.reasoning || '').replace(/\s+/g, ' ').trim()
  if (!text || showContent.value) return ''
  return text.length > 72 ? `…${text.slice(-72)}` : text
})

function toggle() {
  expanded.value = !expanded.value
}

watch(() => props.streaming, streaming => {
  if (timer) { window.clearInterval(timer); timer = null }
  if (streaming) timer = window.setInterval(() => { now.value = Date.now() }, 250)
}, { immediate: true })

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
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
    <div v-if="showContent" :id="contentId" class="cot-step__body">
      <Markdown v-if="reasoning.trim()" class="reasoning-markdown" :content="reasoning" compact />
      <p v-else class="reasoning-placeholder">正在整理思路…</p>
    </div>
  </div>
</template>

<style lang="scss" src="../../styles/components/conversation/ReasoningStep.scss"></style>
