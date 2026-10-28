<!--
一次或多次模型请求的状态行：请求中显示加载和已等待时间，结束后显示输入/输出/缓存和总 tokens。
参考 Roo Code 的 API Request 行：请求中是一行进度，完成后压低存在感，只留消耗摘要。
调用示例：<RequestStatus :requests="message.requests" />
-->
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { KimaSpinner } from '../ui/index.js'
import { AppIcon } from '../ui/index.js'

const props = defineProps({
  requests: { type: Array, default: () => [] },
})

const now = ref(Date.now())
let timer = null
const running = computed(() => props.requests.some(item => item.status === 'running'))
const failed = computed(() => props.requests.find(item => item.status === 'failed'))
const completed = computed(() => props.requests.filter(item => item.status === 'completed'))
const active = computed(() => props.requests.find(item => item.status === 'running'))
const sum = key => props.requests.reduce((total, item) => total + Number(item[key] || 0), 0)
const input = computed(() => sum('input'))
const output = computed(() => sum('output'))
const cache = computed(() => sum('cache'))
const total = computed(() => sum('total') || input.value + output.value)
const duration = computed(() => completed.value.reduce((total, item) => total + Number(item.durationMs || 0), 0))
const elapsed = computed(() => active.value?.startedAt ? Math.max(0, now.value - active.value.startedAt) : 0)

const seconds = value => value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}s`
const label = computed(() => {
  if (running.value) return '正在请求模型…'
  if (failed.value) return '模型请求失败'
  if (completed.value.length > 1) return `模型请求完成 · ${completed.value.length} 次`
  return '模型请求完成'
})
const badge = computed(() => running.value ? seconds(elapsed.value) : `${total.value.toLocaleString()} tokens`)
const detail = computed(() => {
  if (running.value) return '等待模型返回第一个字'
  const parts = []
  if (input.value || output.value) parts.push(`输入 ${input.value.toLocaleString()}`, `输出 ${output.value.toLocaleString()}`)
  if (cache.value) parts.push(`缓存 ${cache.value.toLocaleString()}`)
  if (duration.value) parts.push(seconds(duration.value))
  return parts.join(' · ')
})

watch(running, value => {
  window.clearInterval(timer)
  timer = null
  if (!value) return
  now.value = Date.now()
  timer = window.setInterval(() => { now.value = Date.now() }, 1000)
}, { immediate: true })

onBeforeUnmount(() => window.clearInterval(timer))
</script>

<template>
  <div
    class="request-status"
    :class="{ 'is-running': running, 'is-failed': failed, 'is-done': !running && !failed }"
    :aria-label="`${label} ${detail}`"
  >
    <span class="request-status__icon">
      <KimaSpinner v-if="running" size="small" decorative />
      <AppIcon v-else :name="failed ? 'close' : 'stats'" :size="16" />
    </span>
    <span class="request-status__main">
      <span class="request-status__label">{{ label }}</span>
      <span v-if="detail" class="request-status__detail">{{ detail }}</span>
    </span>
    <span class="request-status__badge">{{ badge }}</span>
  </div>
</template>

<style scoped lang="scss">
.request-status {
  display: flex;
  width: fit-content;
  max-width: 100%;
  align-items: center;
  gap: 9px;
  margin-bottom: 8px;
  padding: 6px 10px;
  border: .5px solid var(--la-line);
  border-radius: 10px;
  background: var(--la-layer-01);
  color: var(--la-muted);
  font-size: 12.5px;
  line-height: 18px;
}
.request-status.is-done { opacity: .74; transition: opacity var(--kima-duration-fast) var(--kima-curve-standard); }
.request-status.is-done:hover { opacity: 1; }
.request-status.is-failed { color: var(--kima-color-error); }
.request-status__icon { display: grid; width: 18px; height: 18px; flex: none; place-items: center; }
.request-status__icon :deep(.kima-spinner__ring) { width: 14px; height: 14px; border-width: 2px; }
.request-status__main { display: flex; min-width: 0; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; }
.request-status__label { color: var(--la-text); font-weight: 500; }
.request-status__detail { color: var(--la-muted); }
.request-status__badge {
  flex: none;
  padding: 1px 7px;
  border: .5px solid var(--la-line);
  border-radius: 7px;
  color: var(--la-muted);
  font-family: var(--la-font-mono);
  font-size: 11.5px;
}
</style>
