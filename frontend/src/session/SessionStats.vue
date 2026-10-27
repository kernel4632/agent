<!--
顶部栏会话统计：默认只显示一个上下文圆环，点开是图形化的会话数据面板。
参考 DeepSeek Harness 的 ContextMeter：圆环表示上下文占用，面板里用环、条、图标和数字看消耗，不堆说明文字。
调用示例：<SessionStats :stats="stats" />
-->
<script setup>
import { computed } from 'vue'
import { KimaPopover, KimaProgress, KimaRingProgress } from '@kernel4632/kima'
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
const percent = computed(() => Math.min(100, rawPercent.value))
const percentText = computed(() => rawPercent.value > 0 && rawPercent.value < 1 ? '<1%' : `${Math.round(rawPercent.value)}%`)
const cacheHit = computed(() => {
  const input = Number(usage.value.input || 0)
  if (!input) return 0
  return Math.min(100, Math.round(Number(usage.value.cacheRead || 0) / input * 100))
})
const total = computed(() => Number(usage.value.total || Number(usage.value.input || 0) + Number(usage.value.output || 0)))
const inputShare = computed(() => {
  const input = Number(usage.value.input || 0)
  const output = Number(usage.value.output || 0)
  return input + output > 0 ? input / (input + output) * 100 : 0
})
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
const ringClass = computed(() => ({
  'is-warn': percent.value >= 70 && percent.value < 90,
  'is-danger': percent.value >= 90,
}))
const hasUsage = computed(() => total.value > 0)
</script>

<template>
  <KimaPopover class="session-stats" variant="text" placement="bottom-end" label="会话统计" content-label="会话统计">
    <template #trigger>
      <KimaRingProgress
        class="session-stats__ring"
        :class="ringClass"
        :value="percent"
        :max="100"
        :size="30"
        :stroke-width="3"
        label="上下文占用"
        aria-hidden="true"
      />
      <span class="sr-only">上下文占用 {{ percentText }}，点击查看会话统计</span>
    </template>

    <div class="stats-panel">
      <div class="stats-panel__hero">
        <div class="stats-panel__ring">
          <KimaRingProgress :value="percent" :max="100" :size="68" :stroke-width="7" label="上下文占用" />
          <span>{{ percentText }}</span>
        </div>
        <div class="stats-panel__context">
          <div class="stats-panel__metric">
            <AppIcon name="document" :size="16" />
            <strong>{{ formatTokens(context.used) }}</strong>
            <span>/ {{ formatTokens(context.limit) }}</span>
          </div>
          <div class="stats-panel__metric stats-panel__metric--muted">
            <AppIcon name="info" :size="15" />
            <span>剩余 {{ formatTokens(Math.max(0, Number(context.limit) - Number(context.used || 0))) }}</span>
          </div>
          <KimaProgress class="stats-panel__context-bar" :value="context.used" :max="context.limit" label="上下文占用" />
        </div>
      </div>

      <template v-if="hasUsage">
        <div class="stats-panel__bar" aria-hidden="true">
          <span class="stats-panel__bar-input" :style="{ width: `${inputShare}%` }"></span>
          <span class="stats-panel__bar-output"></span>
        </div>
        <div class="stats-panel__legend">
          <span><i class="is-input"></i><AppIcon name="up" :size="14" />{{ formatTokens(usage.input) }}</span>
          <span><i class="is-output"></i><AppIcon name="down" :size="14" />{{ formatTokens(usage.output) }}</span>
          <span v-if="usage.cacheRead"><i class="is-cache"></i><AppIcon name="download" :size="14" />{{ formatTokens(usage.cacheRead) }}</span>
          <span v-if="cacheHit" class="stats-panel__cache"><AppIcon name="download" :size="14" />{{ cacheHit }}%</span>
        </div>

        <div class="stats-panel__grid">
          <div class="stats-panel__cell">
            <AppIcon name="stats" :size="16" />
            <strong>{{ formatTokens(total) }}</strong>
            <small>tokens</small>
          </div>
          <div class="stats-panel__cell">
            <AppIcon name="chat" :size="16" />
            <strong>{{ usage.requests }}</strong>
            <small>请求</small>
          </div>
          <div class="stats-panel__cell">
            <AppIcon name="clock" :size="16" />
            <strong>{{ formatDuration(usage.durationMs) }}</strong>
          </div>
          <div v-if="speed" class="stats-panel__cell">
            <AppIcon name="play" :size="16" />
            <strong>{{ speed }}</strong>
          </div>
          <div v-if="usage.reasoning" class="stats-panel__cell">
            <AppIcon name="spark" :size="16" />
            <strong>{{ formatTokens(usage.reasoning) }}</strong>
            <small>推理</small>
          </div>
        </div>
      </template>
    </div>
  </KimaPopover>
</template>

<style scoped lang="scss">
.session-stats { display: inline-flex; }
.session-stats :deep(.kima-button) {
  width: 40px;
  height: 40px;
  min-width: 40px;
  min-height: 40px;
  padding: 0;
  border-radius: 50%;
  color: var(--la-muted);
}
.session-stats :deep(.kima-button:hover) { background: var(--la-hover); color: var(--la-text); }
.session-stats__ring { color: var(--la-accent); }
.session-stats__ring.is-warn { color: var(--la-warning); }
.session-stats__ring.is-danger { color: var(--kima-color-error); }

.stats-panel { display: grid; width: 300px; max-width: calc(100vw - 32px); gap: 14px; padding: 2px; }
.stats-panel__hero { display: flex; align-items: center; gap: 16px; }
.stats-panel__ring { position: relative; display: grid; flex: none; place-items: center; }
.stats-panel__ring > span { position: absolute; color: var(--la-text); font-size: 13px; font-weight: 650; font-variant-numeric: tabular-nums; }
.stats-panel__context { display: grid; min-width: 0; flex: 1; gap: 7px; }
.stats-panel__metric { display: flex; min-width: 0; align-items: baseline; gap: 6px; color: var(--la-text); font-size: 14px; }
.stats-panel__metric svg { align-self: center; color: var(--la-muted); }
.stats-panel__metric strong { font-size: 18px; font-weight: 650; font-variant-numeric: tabular-nums; }
.stats-panel__metric span { color: var(--la-muted); font-size: 12.5px; }
.stats-panel__metric--muted { font-size: 12.5px; }
.stats-panel__context-bar { --kima-progress-height: 5px; }
.stats-panel__bar { display: flex; height: 8px; overflow: hidden; border-radius: 999px; background: var(--la-layer-03); }
.stats-panel__bar-input { background: var(--la-accent); }
.stats-panel__bar-output { flex: 1; background: var(--la-success); }
.stats-panel__legend { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; color: var(--la-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.stats-panel__legend span { display: inline-flex; align-items: center; gap: 4px; }
.stats-panel__legend i { width: 8px; height: 8px; border-radius: 50%; }
.stats-panel__legend i.is-input { background: var(--la-accent); }
.stats-panel__legend i.is-output { background: var(--la-success); }
.stats-panel__legend i.is-cache { background: var(--la-warning); }
.stats-panel__cache { margin-left: auto; color: var(--la-text); }
.stats-panel__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.stats-panel__cell { display: flex; min-width: 0; align-items: center; gap: 6px; padding: 8px 10px; border-radius: 12px; background: var(--la-layer-01); color: var(--la-muted); font-size: 12px; }
.stats-panel__cell svg { flex: none; }
.stats-panel__cell strong { color: var(--la-text); font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
.stats-panel__cell small { color: var(--la-muted); font-size: 11px; }
@media (max-width: 767px) {
  .stats-panel { width: min(300px, calc(100vw - 24px)); }
}
</style>
