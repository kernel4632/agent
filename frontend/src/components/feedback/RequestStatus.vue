<!--
一次模型请求：请求中显示加载和已等待时间，结束后显示这次请求的输入/输出/缓存和耗时。
每次请求在时间线里占自己的位置，完成后留在原地，不再汇总成一条。
调用示例：<RequestStatus :request="request" />
-->
<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import Icon from '../../ui/Icon.vue'
import Fold from '../../ui/Fold.vue'

const props = defineProps({
  request: { type: Object, required: true },
  kind: { type: String, default: 'request' }, // request | compact
})

const now = ref(Date.now())
const surface = ref(null)
const narrow = ref(false)
const expanded = ref(false)
let timer = null
let resizeObserver = null
const compact = computed(() => props.kind === 'compact')
const compactDiagnostic = computed(() => {
  if (!compact.value) return ''
  const reason = props.request.compactReason
  const token = Number(props.request.compactToken || 0)
  const budget = Number(props.request.compactBudget || 0)
  const percent = token && budget ? Math.round(token / budget * 100) : 0
  if (reason === 'automatic') return `自动压缩：估算 ${percent}%`
  if (reason === 'overflow-retry') return '模型报告上下文超长，强制压缩'
  if (reason === 'manual') return '手动压缩'
  return ''
})
const running = computed(() => props.request.status === 'running')
const failed = computed(() => props.request.status === 'failed')
const errorText = computed(() => {
  const value = props.request.error
  if (value == null) return ''
  if (typeof value === 'string') return value === '[object Object]' ? '模型请求失败' : value
  if (typeof value === 'object') {
    const text = value.message || value.error || value.responseBody || value.body
    if (typeof text === 'string' && text.trim()) return text
    try {
      const json = JSON.stringify(value)
      if (json && json !== '{}') return json
    } catch { /* ignore */ }
  }
  return '模型请求失败'
})
const expandable = computed(() => failed.value && Boolean(errorText.value))
function toggleError() {
  if (expandable.value) expanded.value = !expanded.value
}
watch(() => props.request.id, () => { expanded.value = false })
const retrying = computed(() => running.value && Boolean(props.request.retryUntil || props.request.retry))
const retrySeconds = computed(() => {
  const until = Number(props.request.retryUntil || 0)
  if (!until) return 0
  return Math.max(0, Math.ceil((until - now.value) / 1000))
})
// 倒计时到 0 后回到普通“正在请求模型”，不能一直停在“0s 后继续”像卡死。
const retryExpired = computed(() => Boolean(props.request.retryUntil) && retrySeconds.value <= 0)
const retryingActive = computed(() => retrying.value && !retryExpired.value)
const elapsed = computed(() => running.value && props.request.startedAt ? Math.max(0, now.value - props.request.startedAt) : 0)

const seconds = value => value < 1000 ? `${Math.round(value)}ms` : `${Math.round(value / 1000)}s`
// 一行放不下时优先把大数字压成 k/M，不靠换行或省略关键指标。
const compactNumber = value => {
  const number = Number(value || 0)
  if (!Number.isFinite(number) || number <= 0) return '0'
  if (number >= 1000000) return `${(number / 1000000).toFixed(1).replace(/\.0$/, '')}M`
  if (number >= 1000) return `${(number / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return number.toLocaleString()
}
// 再窄一档时去掉小数位和单位文字，指标仍然全部保留。
const shortNumber = value => {
  const number = Number(value || 0)
  if (!Number.isFinite(number) || number <= 0) return '0'
  if (number >= 1000000) return `${Math.round(number / 1000000)}M`
  if (number >= 1000) return `${Math.round(number / 1000)}k`
  return number.toLocaleString()
}
const firstTokenMs = computed(() => {
  if (props.request.firstTokenMs) return Number(props.request.firstTokenMs)
  if (props.request.firstTokenAt && props.request.startedAt) return Math.max(0, props.request.firstTokenAt - props.request.startedAt)
  return 0
})
const label = computed(() => compact.value
  ? (running.value ? '正在压缩上下文…' : failed.value ? '上下文压缩失败' : '上下文压缩完成')
  : (running.value
      ? (firstTokenMs.value ? '正在接收模型流…' : '正在请求模型…')
      : failed.value ? '模型请求失败' : '模型请求完成'))
const badge = computed(() => running.value ? seconds(elapsed.value) : '')
const completedParts = (formatNumber = compactNumber, tight = false) => {
  const parts = []
  const push = (name, value) => parts.push(tight ? `${name}${value}` : `${name} ${value}`)
  if (!compact.value && firstTokenMs.value) push('首字', seconds(firstTokenMs.value))
  if (props.request.durationMs) push(tight ? '耗时' : '总耗时', seconds(props.request.durationMs))
  if (props.request.input || props.request.output) {
    push(tight ? '入' : '输入', formatNumber(props.request.input))
    push(tight ? '出' : '输出', formatNumber(props.request.output))
  }
  if (props.request.cache) push(tight ? '缓' : '缓存', formatNumber(props.request.cache))
  return parts
}
const completedDetail = (formatNumber = narrow.value ? shortNumber : compactNumber, tight = narrow.value) =>
  completedParts(formatNumber, tight).join(tight ? '·' : ' · ')
const detail = computed(() => {
  if (running.value) {
    if (retryingActive.value) {
      const attempt = Number(props.request.retryAttempt || 1)
      if (props.request.retryUntil) return `模型请求失败，第 ${attempt} 次自动重试，${retrySeconds.value}s 后继续…`
      return props.request.retry
    }
    if (compact.value) return compactDiagnostic.value || '正在把前面的对话总结成一段'
    return firstTokenMs.value ? `首字 ${seconds(firstTokenMs.value)}，正在接收` : '等待模型返回第一个字'
  }
  if (failed.value && errorText.value) return errorText.value
  return completedDetail()
})
const fullDetail = computed(() => {
  if (running.value || failed.value) return compactDiagnostic.value ? `${compactDiagnostic.value} · ${detail.value}` : detail.value
  if (compact.value && compactDiagnostic.value) return `${compactDiagnostic.value} · ${completedDetail()}`
  return completedParts(value => Number(value || 0).toLocaleString(), false).join(' · ')
})

watch(running, value => {
  window.clearInterval(timer)
  timer = null
  if (!value) return
  now.value = Date.now()
  timer = window.setInterval(() => { now.value = Date.now() }, 1000)
}, { immediate: true })

onMounted(() => {
  if (!surface.value || typeof ResizeObserver === 'undefined') return
  resizeObserver = new ResizeObserver(([entry]) => { narrow.value = entry.contentRect.width < 620 })
  resizeObserver.observe(surface.value)
})

onBeforeUnmount(() => {
  window.clearInterval(timer)
  resizeObserver?.disconnect()
})
</script>

<template>
  <div
    ref="surface"
    class="request-status"
    :class="{ 'is-running': running, 'is-retrying': retryingActive, 'is-failed': failed, 'is-done': !running && !failed, 'is-expandable': expandable, 'is-expanded': expanded }"
    :role="expandable ? 'button' : undefined"
    :tabindex="expandable ? 0 : undefined"
    :aria-expanded="expandable ? expanded : undefined"
    :aria-label="`${label} ${detail}`"
    :title="fullDetail ? `${label} ${fullDetail}` : label"
    @click="toggleError"
    @keydown.enter.prevent="toggleError"
    @keydown.space.prevent="toggleError"
  >
    <span class="request-status__icon">
      <span v-if="running" class="ui-spinner ui-spinner--small" aria-hidden="true"><span class="ui-spinner__ring"></span></span>
      <Icon v-else :name="failed ? 'close' : 'stats'" :size="16" />
    </span>
    <span class="request-status__main">
      <span class="request-status__label">{{ label }}</span>
      <span v-if="detail" class="request-status__detail">{{ detail }}</span>
    </span>
    <span v-if="badge" class="request-status__badge">{{ badge }}</span>
    <Icon v-if="expandable" name="down" :size="14" class="request-status__caret" :class="{ 'is-open': expanded }" aria-hidden="true" />
    <Fold :open="expanded" class="request-status__error-fold">
      <pre class="request-status__error">{{ errorText }}</pre>
    </Fold>
  </div>
</template>

<style scoped lang="scss" src="../../styles/components/feedback/RequestStatus.scss"></style>
