<!--
一次模型请求：请求中显示加载和已等待时间，结束后显示这次请求的输入/输出/缓存和耗时。
每次请求在时间线里占自己的位置，完成后留在原地，不再汇总成一条。
调用示例：<RequestStatus :request="request" />
-->
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import Icon from '../../ui/Icon.vue'

const props = defineProps({
  request: { type: Object, required: true },
})

const now = ref(Date.now())
let timer = null
const running = computed(() => props.request.status === 'running')
const failed = computed(() => props.request.status === 'failed')
const elapsed = computed(() => running.value && props.request.startedAt ? Math.max(0, now.value - props.request.startedAt) : 0)

const seconds = value => value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}s`
const label = computed(() => running.value ? '正在请求模型…' : failed.value ? '模型请求失败' : '模型请求完成')
const badge = computed(() => running.value ? seconds(elapsed.value) : props.request.total ? `${Number(props.request.total).toLocaleString()} tokens` : '')
const detail = computed(() => {
  if (running.value) return props.request.retry || (props.request.firstTokenAt ? '正在接收回复' : '等待模型返回第一个字')
  if (failed.value && props.request.error) return props.request.error
  const parts = []
  if (props.request.input || props.request.output) {
    parts.push(`输入 ${Number(props.request.input).toLocaleString()}`, `输出 ${Number(props.request.output).toLocaleString()}`)
  }
  if (props.request.cache) parts.push(`缓存 ${Number(props.request.cache).toLocaleString()}`)
  if (props.request.durationMs) parts.push(seconds(props.request.durationMs))
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
      <span v-if="running" class="ui-spinner ui-spinner--small" aria-hidden="true"><span class="ui-spinner__ring"></span></span>
      <Icon v-else :name="failed ? 'close' : 'stats'" :size="16" />
    </span>
    <span class="request-status__main">
      <span class="request-status__label">{{ label }}</span>
      <span v-if="detail" class="request-status__detail">{{ detail }}</span>
    </span>
    <span v-if="badge" class="request-status__badge">{{ badge }}</span>
  </div>
</template>

<style scoped lang="scss" src="../../styles/components/feedback/RequestStatus.scss"></style>
