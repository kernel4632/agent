<!--
顶部栏会话统计：默认只显示一个上下文圆环，点开是图形化的会话数据面板。
圆环优先使用真实请求用量；旧会话没有用量时显示“估算”，不再把有内容的会话画成全 0。
调用示例：<SessionStats :stats="stats" />
-->
<script setup>
import { computed } from 'vue'
import { KimaPopover, KimaRingProgress } from '../ui/index.js'
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
// 顶栏只放得下三四个字符，估算的 ~ 留给面板；圆环本身还是按真实比例画。
const triggerPercent = computed(() => percentText.value.replace('~', ''))
const hasUsage = computed(() => total.value > 0)
const trendLabel = computed(() => usageApproximate.value ? '最近回复' : '最近请求')
const cells = computed(() => {
  const items = [
    { key: 'requests', icon: 'activity', value: usage.value.requests, label: '请求' },
    { key: 'messages', icon: 'chat', value: usage.value.messages, label: '消息' },
  ]
  if (usage.value.durationMs) items.push({ key: 'duration', icon: 'clock', value: formatDuration(usage.value.durationMs), label: '耗时' })
  if (speed.value) items.push({ key: 'speed', icon: 'gauge', value: speed.value, label: '速度' })
  if (usage.value.reasoning) items.push({ key: 'reasoning', icon: 'idea', value: formatTokens(usage.value.reasoning, usageApproximate.value), label: '推理' })
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
      scale: Math.max(7, (input + output) / max * 100),
      title: `第 ${index + 1} 次：输入 ${input}，输出 ${output}`,
    }
  })
})
const trendMax = computed(() => Math.max(1, ...((props.stats.series || []).map(item => Number(item.input || 0) + Number(item.output || 0)))))
</script>

<template>
  <KimaPopover class="session-stats" variant="text" placement="bottom-end" label="会话统计" content-label="会话统计">
    <template #trigger>
      <KimaRingProgress
        class="session-stats__ring"
        :class="ringClass"
        :value="percent"
        :max="100"
        :size="42"
        :stroke-width="4.5"
        label="上下文占用"
        aria-hidden="true"
      />
      <span class="session-stats__percent">{{ triggerPercent }}</span>
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
            :size="92"
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
            <span>{{ context.over ? '超出' : '剩余' }} {{ formatTokens(context.over ? overBy : remaining, contextApproximate) }}</span>
          </div>
          <div class="stats-panel__contextbar" :class="ringClass" role="img" :aria-label="`上下文已用 ${percentText}，自动压缩阈值 ${Math.round(threshold)}%`">
            <span class="stats-panel__contextbar-used" :style="{ width: `${percent}%` }"></span>
            <i v-if="threshold > 0 && threshold < 100" class="stats-panel__contextbar-mark" :style="{ left: `${threshold}%` }" :title="`自动压缩阈值 ${Math.round(threshold)}%`"></i>
          </div>
          <div class="stats-panel__threshold-label">自动压缩 {{ Math.round(threshold) }}%</div>
        </div>
      </div>

      <template v-if="hasUsage">
        <div class="stats-panel__divider"></div>
        <div class="stats-panel__usage">
          <div class="stats-panel__usage-head">
            <span class="stats-panel__heading"><AppIcon name="activity" :size="15" />用量走势</span>
            <strong>{{ formatTokens(total, usageApproximate) }} <small>tokens</small></strong>
          </div>
          <div
            v-if="trendBars.length > 1"
            class="stats-panel__chart"
            role="img"
            :aria-label="`${trendLabel} ${trendBars.length} 次的输入和输出 token`"
          >
            <div class="stats-panel__chart-grid" aria-hidden="true"><i></i><i></i></div>
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
          <div v-else class="stats-panel__stack" aria-hidden="true">
            <span class="is-input" :style="{ width: `${inputShare}%` }"></span>
            <span class="is-output"></span>
          </div>
          <div class="stats-panel__chart-caption">
            <span>{{ trendLabel }} · {{ trendBars.length || 1 }} 次</span>
            <span>最高 {{ formatTokens(trendMax, usageApproximate) }}</span>
          </div>
          <div class="stats-panel__legend">
            <span><i class="is-input"></i><AppIcon name="up" :size="12" />输入 {{ formatTokens(usage.input, usageApproximate) }}</span>
            <span><i class="is-output"></i><AppIcon name="down" :size="12" />输出 {{ formatTokens(usage.output, usageApproximate) }}</span>
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
      </template>
    </div>
  </KimaPopover>
</template>

<style scoped lang="scss" src="../styles/session/SessionStats.scss"></style>
