<!--
输入框下方的会话统计：上下文占用、总 token 消耗、缓存命中、请求次数和耗时。
参考 DeepSeek Harness 的 composer dock / ContextMeter：数字平时压成一行小字，点开才看明细。
调用示例：<ComposerStats :stats="sessionStats" />
-->
<script setup>
import { computed } from 'vue'
import { KimaPopover, KimaProgress } from '@kernel4632/kima'
import { AppIcon } from '../ui/index.js'

const props = defineProps({
  stats: { type: Object, required: true },
})

const context = computed(() => props.stats.context || {})
const usage = computed(() => props.stats.usage || {})
const rawPercent = computed(() => {
  const limit = Number(context.value.limit || 0)
  if (!limit) return 0
  return Math.max(0, Number(context.value.used || 0) / limit * 100)
})
const percent = computed(() => Math.min(100, Math.round(rawPercent.value)))
const percentText = computed(() => rawPercent.value > 0 && rawPercent.value < 1 ? '<1%' : `${percent.value}%`)
const cacheHit = computed(() => {
  const input = Number(usage.value.input || 0)
  if (!input) return 0
  return Math.min(100, Math.round(Number(usage.value.cacheRead || 0) / input * 100))
})
const total = computed(() => Number(usage.value.total || Number(usage.value.input || 0) + Number(usage.value.output || 0)))
const formatTokens = value => {
  const number = Number(value || 0)
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`
  if (number >= 1000) return `${(number / 1000).toFixed(1)}K`
  return String(number)
}
const formatDuration = value => {
  const ms = Number(value || 0)
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  return `${Math.floor(seconds / 60)}m${Math.round(seconds % 60)}s`
}
const speed = computed(() => {
  const ms = Number(usage.value.durationMs || 0)
  if (!ms || !usage.value.output) return ''
  return `${(Number(usage.value.output) / (ms / 1000)).toFixed(0)} tok/s`
})
const ringDash = computed(() => `${Math.max(0, Math.min(100, percent.value))} ${100 - Math.max(0, Math.min(100, percent.value))}`)
const ringClass = computed(() => ({
  'is-warn': percent.value >= 70 && percent.value < 90,
  'is-danger': percent.value >= 90,
}))
const activity = computed(() => {
  if (!usage.value.requests) return ''
  return `${usage.value.requests} 次请求${usage.value.durationMs ? ` · ${formatDuration(usage.value.durationMs)}` : ''}`
})
</script>

<template>
  <div class="composer-stats" aria-label="会话统计">
    <KimaPopover
      v-if="context.limit"
      class="composer-stats__item"
      variant="text"
      placement="top-start"
      label="上下文使用详情"
      content-label="上下文使用"
    >
      <template #trigger>
        <span class="composer-stats__ring" :class="ringClass" aria-hidden="true">
          <!-- 14px 的小圆环；KimaRingProgress 最小 32px，输入框下方放不下，已提 KIMA issue。 -->
          <svg viewBox="0 0 16 16" width="14" height="14">
            <circle class="composer-stats__track" cx="8" cy="8" r="6" />
            <circle class="composer-stats__fill" cx="8" cy="8" r="6" :stroke-dasharray="ringDash" transform="rotate(-90 8 8)" />
          </svg>
        </span>
        <span>上下文 {{ percentText }}</span>
      </template>
      <div class="stat-panel">
        <header class="stat-panel__head">
          <span>上下文占用</span>
          <strong>{{ percentText }}</strong>
        </header>
        <p class="stat-panel__figures">{{ formatTokens(context.used) }} / {{ formatTokens(context.limit) }} tokens</p>
        <KimaProgress class="stat-panel__bar" :value="context.used" :max="context.limit" label="上下文占用" />
        <dl class="stat-panel__rows">
          <div><dt>已用</dt><dd>{{ formatTokens(context.used) }}</dd></div>
          <div><dt>剩余</dt><dd>{{ formatTokens(Math.max(0, Number(context.limit) - Number(context.used || 0))) }}</dd></div>
          <div v-if="context.threshold"><dt>自动压缩</dt><dd>{{ Math.round(context.threshold * 100) }}%</dd></div>
        </dl>
      </div>
    </KimaPopover>

    <span v-if="context.limit && total" class="composer-stats__sep" aria-hidden="true">·</span>

    <KimaPopover
      v-if="total"
      class="composer-stats__item"
      variant="text"
      placement="top-start"
      label="Token 消耗详情"
      content-label="Token 消耗"
    >
      <template #trigger>
        <AppIcon name="stats" :size="14" />
        <span>总消耗 {{ formatTokens(total) }} tok</span>
        <span v-if="cacheHit">· 缓存 {{ cacheHit }}%</span>
      </template>
      <div class="stat-panel">
        <header class="stat-panel__head">
          <span>Token 消耗</span>
          <strong>{{ total.toLocaleString() }}</strong>
        </header>
        <dl class="stat-panel__rows">
          <div><dt>输入</dt><dd>{{ Number(usage.input || 0).toLocaleString() }}</dd></div>
          <div><dt>输出</dt><dd>{{ Number(usage.output || 0).toLocaleString() }}</dd></div>
          <div v-if="usage.cacheRead"><dt>缓存读取</dt><dd>{{ Number(usage.cacheRead).toLocaleString() }}</dd></div>
          <div v-if="usage.cacheWrite"><dt>缓存写入</dt><dd>{{ Number(usage.cacheWrite).toLocaleString() }}</dd></div>
          <div v-if="usage.reasoning"><dt>推理</dt><dd>{{ Number(usage.reasoning).toLocaleString() }}</dd></div>
          <div v-if="cacheHit"><dt>缓存命中</dt><dd>{{ cacheHit }}%</dd></div>
          <div v-if="usage.requests"><dt>请求次数</dt><dd>{{ usage.requests }}</dd></div>
          <div v-if="usage.durationMs"><dt>模型耗时</dt><dd>{{ formatDuration(usage.durationMs) }}</dd></div>
          <div v-if="speed"><dt>输出速度</dt><dd>{{ speed }}</dd></div>
        </dl>
      </div>
    </KimaPopover>

    <span v-if="activity" class="composer-stats__activity"><span class="composer-stats__sep" aria-hidden="true">·</span> {{ activity }}</span>
  </div>
</template>

<style scoped lang="scss">
.composer-stats {
  display: flex;
  width: 100%;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 4px;
  padding: 6px 12px 0;
  color: var(--la-muted);
  font-size: 12px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
}
.composer-stats__item { min-width: 0; }
.composer-stats__item :deep(.kima-button) {
  min-height: 24px;
  padding: 0 6px;
  border-radius: 8px;
  color: var(--la-muted);
  font-size: 12px;
  font-weight: 400;
  gap: 5px;
}
.composer-stats__item :deep(.kima-button:hover) { background: var(--la-hover); color: var(--la-text); }
.composer-stats__ring { display: inline-flex; }
.composer-stats__track, .composer-stats__fill { fill: none; stroke-width: 2; }
.composer-stats__track { stroke: var(--la-layer-03); }
.composer-stats__fill { stroke: var(--la-muted); stroke-linecap: round; }
.composer-stats__ring.is-warn .composer-stats__fill { stroke: var(--la-warning); }
.composer-stats__ring.is-danger .composer-stats__fill { stroke: var(--kima-color-error); }
.composer-stats__sep { color: var(--la-line); }
.composer-stats__activity { padding: 0 6px; }
.stat-panel { display: grid; min-width: 230px; gap: 10px; padding: 2px; }
.stat-panel__head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; color: var(--la-text); font-size: 13px; font-weight: 600; }
.stat-panel__head strong { font-size: 15px; font-variant-numeric: tabular-nums; }
.stat-panel__figures { margin: 0; color: var(--la-muted); font-size: 12.5px; }
.stat-panel__bar { --kima-progress-height: 4px; }
.stat-panel__rows { display: grid; gap: 6px; margin: 0; }
.stat-panel__rows > div { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
.stat-panel__rows dt { color: var(--la-muted); font-size: 12.5px; }
.stat-panel__rows dd { margin: 0; color: var(--la-text); font-family: var(--la-font-mono); font-size: 12.5px; }
@media (max-width: 767px) {
  .composer-stats { padding: 6px 10px 0; }
  .composer-stats__activity { padding: 0 4px; }
}
</style>
