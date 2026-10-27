<!--
顶部栏会话统计：默认只显示一个上下文圆环，点开是图形化的会话数据面板。
圆环优先使用真实请求用量；旧会话没有用量时显示“估算”，不再把有内容的会话画成全 0。
调用示例：<SessionStats :stats="stats" />
-->
<script setup>
import { computed } from 'vue'
import { KimaPopover, KimaRingProgress } from '@kernel4632/kima'
import { AppIcon } from '../ui/index.js'

const props = defineProps({
  stats: { type: Object, required: true },
})

const context = computed(() => props.stats.context || {})
const usage = computed(() => props.stats.usage || {})
const approximate = computed(() => Boolean(props.stats.approximate))
const contextApproximate = computed(() => Boolean(context.value.approximate))
const usageApproximate = computed(() => Boolean(usage.value.approximate))
const rawPercent = computed(() => {
  const limit = Number(context.value.limit || 0)
  if (!limit) return 0
  return Math.max(0, Number(context.value.used || 0) / limit * 100)
})
const percent = computed(() => Math.min(100, rawPercent.value))
const percentText = computed(() => {
  const prefix = contextApproximate.value ? '~' : ''
  if (rawPercent.value > 0 && rawPercent.value < 1) return `${prefix}<1%`
  return `${prefix}${Math.round(rawPercent.value)}%`
})
const remaining = computed(() => Math.max(0, Number(context.value.limit || 0) - Number(context.value.used || 0)))
const overBy = computed(() => Math.max(0, Number(context.value.used || 0) - Number(context.value.limit || 0)))
const threshold = computed(() => Math.min(100, Math.max(0, Number(context.value.threshold || 0.8) * 100)))
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
const formatTokens = (value, isApproximate = false) => {
  const number = Number(value || 0)
  const prefix = isApproximate ? '~' : ''
  if (number >= 1_000_000) return `${prefix}${(number / 1_000_000).toFixed(1)}M`
  if (number >= 1000) return `${prefix}${(number / 1000).toFixed(1)}K`
  return `${prefix}${number}`
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
const cells = computed(() => {
  const items = [
    { key: 'requests', icon: 'refresh', value: usage.value.requests, label: '请求' },
    { key: 'messages', icon: 'chat', value: usage.value.messages, label: '消息' },
  ]
  if (usage.value.durationMs) items.push({ key: 'duration', icon: 'clock', value: formatDuration(usage.value.durationMs), label: '耗时' })
  if (speed.value) items.push({ key: 'speed', icon: 'gauge', value: speed.value, label: '速度' })
  if (usage.value.reasoning) items.push({ key: 'reasoning', icon: 'spark', value: formatTokens(usage.value.reasoning, usageApproximate.value), label: '推理' })
  return items
})
const trendBars = computed(() => {
  const series = props.stats.series || []
  const max = Math.max(1, ...series.map(item => Number(item.input || 0) + Number(item.output || 0)))
  return series.map((item, index) => {
    const input = Number(item.input || 0)
    const output = Number(item.output || 0)
    return {
      key: index,
      input,
      output,
      scale: Math.max(6, (input + output) / max * 100),
      title: `第 ${index + 1} 次请求：输入 ${input}，输出 ${output}`,
    }
  })
})
</script>

<template>
  <KimaPopover class="session-stats" variant="text" placement="bottom-end" label="会话统计" content-label="会话统计">
    <template #trigger>
      <KimaRingProgress
        class="session-stats__ring"
        :class="ringClass"
        :value="percent"
        :max="100"
        :size="36"
        :stroke-width="3.5"
        label="上下文占用"
        aria-hidden="true"
      />
      <span class="session-stats__percent">{{ percentText }}</span>
      <span class="sr-only">上下文占用 {{ percentText }}，点击查看会话统计</span>
    </template>

    <div class="stats-panel">
      <div class="stats-panel__head">
        <span class="stats-panel__heading"><AppIcon name="stats" :size="15" />会话统计</span>
        <span v-if="approximate" class="stats-panel__badge" title="旧会话没有保存每次请求的用量，数字按消息内容估算">估算</span>
      </div>

      <div class="stats-panel__hero">
        <div class="stats-panel__ring">
          <KimaRingProgress
            :class="ringClass"
            :value="percent"
            :max="100"
            :size="88"
            :stroke-width="8"
            label="上下文占用"
          />
          <span class="stats-panel__percent">{{ percentText }}</span>
        </div>
        <div class="stats-panel__context">
          <div class="stats-panel__eyebrow"><AppIcon name="layers" :size="14" />上下文</div>
          <div class="stats-panel__value">
            <strong>{{ formatTokens(context.used, contextApproximate) }}</strong>
            <span>/ {{ formatTokens(context.limit) }}</span>
          </div>
          <div class="stats-panel__left" :class="{ 'is-over': context.over }">
            <AppIcon :name="context.over ? 'info' : 'database'" :size="13" />
            <span>{{ context.over ? '超出' : '剩余' }} {{ formatTokens(context.over ? overBy : remaining, contextApproximate) }}</span>
          </div>
        </div>
      </div>

      <div class="stats-panel__contextbar" :class="ringClass" role="img" :aria-label="`上下文已用 ${percentText}，自动压缩阈值 ${Math.round(threshold)}%`">
        <span class="stats-panel__contextbar-used" :style="{ width: `${percent}%` }"></span>
        <i v-if="threshold > 0 && threshold < 100" class="stats-panel__contextbar-mark" :style="{ left: `${threshold}%` }" :title="`自动压缩阈值 ${Math.round(threshold)}%`"></i>
      </div>

      <template v-if="hasUsage">
        <div class="stats-panel__divider"></div>
        <div class="stats-panel__usage">
          <div class="stats-panel__usage-head">
            <span class="stats-panel__heading"><AppIcon name="database" :size="15" />累计用量</span>
            <strong>{{ formatTokens(total, usageApproximate) }}</strong>
          </div>
          <div class="stats-panel__stack" aria-hidden="true">
            <span class="is-input" :style="{ width: `${inputShare}%` }"></span>
            <span class="is-output"></span>
          </div>
          <div class="stats-panel__legend">
            <span><i class="is-input"></i><AppIcon name="up" :size="12" />{{ formatTokens(usage.input, usageApproximate) }}</span>
            <span><i class="is-output"></i><AppIcon name="down" :size="12" />{{ formatTokens(usage.output, usageApproximate) }}</span>
            <span v-if="cacheHit" class="stats-panel__cache"><i class="is-cache"></i><AppIcon name="download" :size="12" />{{ cacheHit }}%</span>
          </div>
        </div>

        <div class="stats-panel__chips">
          <div v-for="cell in cells" :key="cell.key" class="stats-panel__chip">
            <span class="stats-panel__chip-icon"><AppIcon :name="cell.icon" :size="14" /></span>
            <strong>{{ cell.value }}</strong>
            <small>{{ cell.label }}</small>
          </div>
        </div>

        <div v-if="trendBars.length > 1" class="stats-panel__trend">
          <div class="stats-panel__trend-head">
            <span class="stats-panel__heading"><AppIcon name="stats" :size="13" />最近请求</span>
            <span>{{ trendBars.length }} 次</span>
          </div>
          <div class="stats-panel__bars">
            <span
              v-for="bar in trendBars"
              :key="bar.key"
              class="stats-panel__bar"
              :style="{ height: `${bar.scale}%` }"
              :title="bar.title"
            >
              <i class="is-output" :style="{ flex: bar.output || 0.001 }"></i>
              <i class="is-input" :style="{ flex: bar.input || 0.001 }"></i>
            </span>
          </div>
        </div>
      </template>
    </div>
  </KimaPopover>
</template>

<style scoped lang="scss">
.session-stats { display: inline-flex; }
.session-stats :deep(.kima-button) {
  position: relative;
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
.session-stats__ring :deep(.kima-ring-progress__track) { stroke: color-mix(in srgb, var(--la-text) 16%, transparent); }
.session-stats__ring.is-warn { color: var(--la-warning); }
.session-stats__ring.is-danger { color: var(--kima-color-error); }
.session-stats__percent {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--la-text);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: -.03em;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

.stats-panel { display: grid; width: 100%; gap: 12px; }
.stats-panel__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.stats-panel__heading { display: inline-flex; align-items: center; gap: 6px; color: var(--la-secondary); font-size: 12.5px; font-weight: 650; }
.stats-panel__heading svg { color: var(--la-muted); }
.stats-panel__badge {
  padding: 2px 7px;
  border: 1px solid color-mix(in srgb, var(--la-warning) 35%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--la-warning) 12%, transparent);
  color: var(--la-warning);
  font-size: 10.5px;
  font-weight: 650;
}

.stats-panel__hero { display: flex; align-items: center; gap: 16px; padding: 2px 0; }
.stats-panel__ring { position: relative; display: grid; flex: none; place-items: center; }
.stats-panel__ring::before {
  position: absolute;
  inset: 7px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--la-accent) 9%, transparent);
  content: "";
}
.stats-panel__ring :deep(.kima-ring-progress) { position: relative; color: var(--la-accent); }
.stats-panel__ring :deep(.kima-ring-progress__track) { stroke: color-mix(in srgb, var(--la-text) 16%, transparent); }
.stats-panel__ring :deep(.kima-ring-progress.is-warn) { color: var(--la-warning); }
.stats-panel__ring :deep(.kima-ring-progress.is-danger) { color: var(--kima-color-error); }
.stats-panel__percent { position: absolute; color: var(--la-text); font-size: 17px; font-weight: 700; letter-spacing: -.04em; font-variant-numeric: tabular-nums; }
.stats-panel__context { display: grid; min-width: 0; flex: 1; gap: 4px; }
.stats-panel__eyebrow { display: flex; align-items: center; gap: 4px; color: var(--la-muted); font-size: 11.5px; }
.stats-panel__value { display: flex; min-width: 0; align-items: baseline; gap: 5px; }
.stats-panel__value strong { color: var(--la-text); font-size: 23px; font-weight: 700; letter-spacing: -.035em; font-variant-numeric: tabular-nums; line-height: 1.15; }
.stats-panel__value span { color: var(--la-muted); font-size: 12.5px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.stats-panel__left { display: flex; align-items: center; gap: 4px; color: var(--la-muted); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.stats-panel__left.is-over { color: var(--kima-color-error); }

.stats-panel__contextbar { position: relative; height: 7px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, var(--la-text) 9%, transparent); }
.stats-panel__contextbar-used { position: absolute; inset-block: 0; left: 0; border-radius: 999px; background: linear-gradient(90deg, color-mix(in srgb, var(--la-accent) 72%, transparent), var(--la-accent)); transition: width var(--kima-duration-medium) var(--kima-curve-standard); }
.stats-panel__contextbar.is-warn .stats-panel__contextbar-used { background: linear-gradient(90deg, color-mix(in srgb, var(--la-warning) 72%, transparent), var(--la-warning)); }
.stats-panel__contextbar.is-danger .stats-panel__contextbar-used { background: linear-gradient(90deg, color-mix(in srgb, var(--kima-color-error) 72%, transparent), var(--kima-color-error)); }
.stats-panel__contextbar-mark { position: absolute; top: 0; bottom: 0; width: 1.5px; border-radius: 2px; background: color-mix(in srgb, var(--la-text) 55%, transparent); }
.stats-panel__legend { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; color: var(--la-muted); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.stats-panel__legend span { display: inline-flex; align-items: center; gap: 4px; }
.stats-panel__legend i { width: 7px; height: 7px; flex: none; border-radius: 50%; }
.stats-panel__legend i.is-input { background: var(--la-accent); }
.stats-panel__legend i.is-output { background: var(--la-success); }
.stats-panel__legend i.is-cache { background: var(--la-warning); }
.stats-panel__cache { color: var(--la-secondary); }
.stats-panel__divider { height: 1px; background: var(--la-line); }

.stats-panel__usage { display: grid; gap: 8px; }
.stats-panel__usage-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.stats-panel__usage-head strong { color: var(--la-text); font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
.stats-panel__stack { display: flex; height: 8px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, var(--la-text) 8%, transparent); }
.stats-panel__stack .is-input { background: var(--la-accent); }
.stats-panel__stack .is-output { flex: 1; background: var(--la-success); }

.stats-panel__chips { display: flex; flex-wrap: wrap; gap: 4px; }
.stats-panel__chip { display: inline-flex; min-width: 0; flex: none; max-width: 100%; align-items: center; gap: 4px; padding: 4px 7px 4px 5px; border: 1px solid color-mix(in srgb, var(--la-text) 7%, transparent); border-radius: 9px; background: color-mix(in srgb, var(--la-text) 4%, transparent); }
.stats-panel__chip-icon { display: grid; width: 18px; height: 18px; flex: none; place-items: center; border-radius: 5px; background: color-mix(in srgb, var(--la-accent) 11%, transparent); color: var(--la-accent); }
.stats-panel__chip strong { color: var(--la-text); font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
.stats-panel__chip small { color: var(--la-muted); font-size: 10px; white-space: nowrap; }

.stats-panel__trend { display: grid; gap: 7px; padding-top: 2px; }
.stats-panel__trend-head { display: flex; align-items: center; justify-content: space-between; color: var(--la-muted); font-size: 10.5px; font-variant-numeric: tabular-nums; }
.stats-panel__bars { display: flex; height: 36px; align-items: flex-end; gap: 3px; }
.stats-panel__bar { display: flex; min-width: 3px; flex: 1; max-width: 14px; flex-direction: column; overflow: hidden; border-radius: 3px 3px 2px 2px; transition: height var(--kima-duration-medium) var(--kima-curve-standard); }
.stats-panel__bar i { display: block; width: 100%; }
.stats-panel__bar i.is-input { background: var(--la-accent); }
.stats-panel__bar i.is-output { background: var(--la-success); }

@media (max-width: 360px) {
  .stats-panel__hero { gap: 12px; }
  .stats-panel__ring :deep(.kima-ring-progress) { width: 76px !important; height: 76px !important; }
  .stats-panel__percent { font-size: 15px; }
}
</style>
