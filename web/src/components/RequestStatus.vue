<!--
一次模型请求：只在 request-start 真正到达后出现。
进行中：计时、是否已收到首字；失败待重试：原因和倒计时；结束后：首字、耗时、输入 / 输出 / 缓存 token。
数据读 assistant / compact 消息上的 request，随历史保存，翻旧对话也一样；没报的用量显示“无”，不当 0。
调用示例：<component :is="Components.RequestStatus" :step="{ kind: 'request', key, request }" />
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watchEffect } from 'vue'
import type { Step } from './History.vue'

const props = defineProps<{ step: Extract<Step, { kind: 'request' }> }>()
const now = ref(Date.now())
const open = ref(false)
let timer = 0
watchEffect(() => {
  clearInterval(timer)
  if (props.step.live || props.step.retry) timer = window.setInterval(() => { now.value = Date.now() }, 250)
})
onBeforeUnmount(() => clearInterval(timer))

const seconds = (ms: number) => ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
const tokens = (value?: number) => value === undefined ? '无' : value >= 1000 ? `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(value)
const errors = computed(() => props.step.errors ?? [])
const tone = computed(() => props.step.live ? 'live' : props.step.retry ? 'retry' : errors.value.length ? 'failed' : 'done')

const label = computed(() => {
  const { live, request, retry } = props.step
  if (live) return `${live.compact ? '压缩 · ' : ''}${live.model}${live.attempt > 1 ? ` · 第 ${live.attempt} 次尝试` : ''}`
  if (retry) return `请求失败，${Math.max(0, Math.ceil((retry.until - now.value) / 1000))}s 后第 ${retry.attempt + 1} 次尝试`
  if (errors.value.length) return `请求失败 ${errors.value.length} 次，已自动重试`
  return `${props.step.compact ? '压缩 · ' : ''}${request?.model ?? '请求'}`
})
const detail = computed(() => {
  const { live, request } = props.step
  if (live) return [live.first ? `首字 ${seconds(live.first)} · 接收中` : '等待首字', seconds(now.value - live.start)]
  if (errors.value.length) return [errors.value.at(-1)!.content]
  if (!request) return []
  const usage = request.usage
  return [request.first !== undefined ? `首字 ${seconds(request.first)}` : '', `用时 ${seconds(request.duration)}`,
    `入 ${tokens(usage?.input)}`, `出 ${tokens(usage?.output)}`, `缓存 ${tokens(usage?.cacheRead)}`].filter(Boolean)
})
</script>

<template>
  <div class="request" :class="`is-${tone}`">
    <button class="request__line" type="button" :disabled="!errors.length" @click="open = !open">
      <span class="request__icon">
        <span v-if="tone === 'live'" class="spinner" />
        <svg v-else-if="tone === 'done'" viewBox="0 0 16 16" width="13" height="13"><path d="M3 13V8M8 13V3M13 13v-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
        <svg v-else viewBox="0 0 16 16" width="13" height="13"><path d="M8 4.5v4M8 11.2v.1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.3" /></svg>
      </span>
      <span class="request__label">{{ label }}</span>
      <span v-if="detail.length" class="request__detail">{{ detail.join(' · ') }}</span>
    </button>
    <pre v-if="open" class="request__error">{{ errors.map(error => error.content).join('\n') }}</pre>
  </div>
</template>

<style scoped>
.request__line { display: flex; align-items: center; gap: 8px; min-height: 28px; width: 100%; padding: 0; border: 0; background: none; font: inherit; font-size: 13px; color: var(--muted); text-align: left; cursor: default; overflow: hidden; white-space: nowrap; }
.request__line:enabled { cursor: pointer; }
.request__icon { display: inline-flex; width: 14px; justify-content: center; flex: none; color: var(--faint); }
.request__label { color: var(--muted); flex: none; }
.request__detail { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--faint); font-variant-numeric: tabular-nums; }
.is-live .request__label { color: var(--text); }
.is-retry .request__icon, .is-retry .request__label { color: var(--warn); }
.is-failed .request__icon { color: var(--warn); }
.request__error { margin: 4px 0 8px 22px; padding: 10px 12px; border-radius: 12px; background: var(--soft); color: var(--muted); font: 12px/1.6 var(--mono); white-space: pre-wrap; }
</style>
