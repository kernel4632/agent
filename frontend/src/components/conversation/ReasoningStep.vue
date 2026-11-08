<!--
思考步骤：流式时半展开预览（最高 120px、上下渐隐、自动滚到底部），结束后自动收起成一行摘要。
点标题展开完整思考；流式预览点一下先展开全文，用户点收过就不再自动展开，直到重新点开。
对应 RikkaHub 的 ReasoningCardState：Preview 态最高 120px、上下渐隐、内容更新就滚到底。
调用示例：<ReasoningStep :reasoning="message.reasoning" :streaming="message.isStreaming" :started-at="message.startedAt" :finished-at="message.finishedAt" />
-->
<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
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
const collapsed = ref(false)
const now = ref(Date.now())
const previewEl = ref(null)
const displayedReasoning = ref(props.reasoning || '')
let timer = null
let reasoningTimer = 0
let pendingReasoning = props.reasoning || ''

// 折叠预览只保留最后一段。思考可能有几万字，但预览区只有 120px；
// 若把全文一直挂进 Markdown，每一段 delta 都要重新解析整段，主线程会被拖死。
const PREVIEW_TAIL = 4000
function previewTail(text) {
  const value = String(text || '')
  if (value.length <= PREVIEW_TAIL) return value
  const cut = value.length - PREVIEW_TAIL
  const line = value.indexOf('\n', cut)
  return line >= 0 ? value.slice(line + 1) : value.slice(cut)
}
const shownReasoning = computed(() => expanded.value ? displayedReasoning.value : previewTail(displayedReasoning.value))

// 收起是用户明确动作：流式期间也不再强制展开，直到用户重新点开。
const previewing = computed(() => props.streaming && !expanded.value && !collapsed.value)
const showContent = computed(() => expanded.value || previewing.value)
const seconds = computed(() => {
  if (!props.startedAt) return 0
  return Math.max(0, ((props.finishedAt || now.value) - props.startedAt) / 1000)
})
const label = computed(() => {
  if (props.streaming && !props.reasoning) return '正在思考…'
  return props.startedAt ? `深度思考 ${seconds.value.toFixed(1)} 秒` : '深度思考'
})
// 收起后只在标题行看最后一句，长思考不用整段扫一遍。
const tail = computed(() => {
  const text = props.reasoning || ''
  if (!text || showContent.value) return ''
  const end = text.slice(-160).replace(/\s+/g, ' ').trim()
  if (!end) return ''
  return text.length > 72 ? `…${end.slice(-72)}` : end
})

// 网络增量可能远高于屏幕刷新率；思考正文最多每 50ms 合并一次。
watch(() => props.reasoning, value => {
  pendingReasoning = value || ''
  if (!props.streaming || pendingReasoning.length < displayedReasoning.value.length) {
    if (reasoningTimer) { window.clearTimeout(reasoningTimer); reasoningTimer = 0 }
    displayedReasoning.value = pendingReasoning
    return
  }
  if (reasoningTimer) return
  reasoningTimer = window.setTimeout(() => {
    reasoningTimer = 0
    displayedReasoning.value = pendingReasoning
  }, 50)
}, { immediate: true })

watch(() => props.streaming, streaming => {
  // 结束就收起，历史轮次保持一行摘要。
  if (!streaming) {
    if (reasoningTimer) { window.clearTimeout(reasoningTimer); reasoningTimer = 0 }
    displayedReasoning.value = props.reasoning || ''
    expanded.value = false
  }
  if (timer) { window.clearInterval(timer); timer = null }
  if (streaming) timer = window.setInterval(() => { now.value = Date.now() }, 100)
}, { immediate: true })

function toggle() {
  if (expanded.value) {
    expanded.value = false
    collapsed.value = true
    return
  }
  // 流式预览点一下先展开全文；已经收起时再点恢复到最新进度。
  expanded.value = true
  collapsed.value = false
}

// 预览的内容一直在追加，停在顶部就看不到模型正在写什么；每次显示更新都滚到底。
function pinPreview() {
  nextTick(() => {
    if (previewEl.value) previewEl.value.scrollTop = previewEl.value.scrollHeight
  })
}

watch(shownReasoning, pinPreview)
watch(previewing, pinPreview)

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
  if (reasoningTimer) window.clearTimeout(reasoningTimer)
})
</script>

<template>
  <div class="cot-step cot-step--reasoning">
    <span class="cot-step__icon"><Icon name="idea" :size="16" /></span>
    <button type="button" class="cot-step__head" :aria-expanded="showContent" :aria-controls="contentId" @click="toggle">
      <span class="cot-step__label" :class="{ 'is-live': streaming }">{{ label }}</span>
      <span v-if="tail" class="cot-step__summary" :title="tail">{{ tail }}</span>
      <Icon name="down" :size="16" class="cot-step__caret" :class="{ 'is-open': showContent }" aria-hidden="true" />
    </button>
    <div :id="contentId" class="cot-collapse" :class="{ 'is-open': showContent }" :inert="!showContent" :aria-hidden="!showContent">
      <div class="cot-collapse__inner">
        <div class="cot-step__body">
          <div ref="previewEl" class="reasoning-preview" :class="{ 'is-preview': previewing }">
            <Markdown v-if="shownReasoning.trim()" class="reasoning-markdown" :content="shownReasoning" compact />
            <p v-else class="reasoning-placeholder">正在整理思路…</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" src="../../styles/components/conversation/ReasoningStep.scss"></style>
