<!--
输入框下方的会话状态：展示上下文、token 与速度；每一项独立展开自己的面板。
真实请求数据优先；旧会话缺少记录时显示“估算”。
调用示例：<StatsPanel :stats="stats" />。
-->
<script setup>
import { computed } from 'vue'
import Menu from '../../ui/Menu.vue'
import RingProgress from '../../ui/RingProgress.vue'
import Icon from '../../ui/Icon.vue'

const props = defineProps({ stats: { type: Object, required: true } })

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
const total = computed(() => Number(usage.value.total || Number(usage.value.input || 0) + Number(usage.value.output || 0)))
const cacheTokens = computed(() => Math.max(0, Number(usage.value.cacheRead || 0)))
const cacheWriteTokens = computed(() => Math.max(0, Number(usage.value.cacheWrite || 0)))
const cacheRead = computed(() => Math.min(Number(usage.value.input || 0), cacheTokens.value))
const cacheHit = computed(() => {
  const input = Number(usage.value.input || 0)
  if (!input) return 0
  return Math.min(100, Math.round(cacheTokens.value / input * 100))
})
// 底栏显示一位小数，面板保留整数；100% 不显示成 100.0%。
const cacheHitText = computed(() => {
  const input = Number(usage.value.input || 0)
  if (!input) return '0'
  const percent = Math.min(100, cacheTokens.value / input * 100)
  return percent >= 100 ? '100' : percent.toFixed(1).replace(/\.0$/, '')
})
const shares = computed(() => {
  const input = Number(usage.value.input || 0)
  const output = Number(usage.value.output || 0)
  const sum = input + output
  if (!sum) return { input: 0, cache: 0, output: 0 }
  return {
    input: Math.max(0, input - cacheRead.value) / sum * 100,
    cache: cacheRead.value / sum * 100,
    output: output / sum * 100,
  }
})
const formatTokens = (value, isApproximate = false) => {
  const number = Number(value || 0)
  const prefix = isApproximate ? '~' : ''
  if (number >= 1_000_000) return `${prefix}${(number / 1_000_000).toFixed(1)}M`
  if (number >= 1000) return `${prefix}${(number / 1000).toFixed(1)}K`
  return `${prefix}${number}`
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
const trendLabel = computed(() => usageApproximate.value ? '最近回复' : '最近请求')
const trendBars = computed(() => {
  const series = props.stats.series || []
  const max = Math.max(1, ...series.map(item => Number(item.input || 0) + Number(item.output || 0)))
  return series.map((item, index) => {
    const input = Number(item.input || 0)
    const output = Number(item.output || 0)
    const cache = Math.min(input, Math.max(0, Number(item.cache || 0)))
    return {
      key: index,
      input,
      output,
      cache,
      fresh: Math.max(0, input - cache),
      scale: Math.max(7, (input + output) / max * 100),
      title: `第 ${index + 1} 次：输入 ${input}（缓存 ${cache}），输出 ${output}`,
    }
  })
})
const trendMax = computed(() => Math.max(1, ...((props.stats.series || []).map(item => Number(item.input || 0) + Number(item.output || 0)))))
const speedGroups = computed(() => [...(props.stats.models || [])].sort((a, b) => (b.averageDurationMs - a.averageDurationMs) || (a.averageTps - b.averageTps)))
const overallAverageDuration = computed(() => {
  const groups = speedGroups.value.filter(group => group.averageDurationMs > 0)
  if (!groups.length) return 0
  return groups.reduce((sum, group) => sum + group.averageDurationMs, 0) / groups.length
})
const isSlow = group => overallAverageDuration.value > 0 && group.averageDurationMs > overallAverageDuration.value * 1.2
const formatDuration = value => {
  const ms = Number(value || 0)
  if (!ms) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  return `${Math.floor(seconds / 60)}m${Math.round(seconds % 60)}s`
}
</script>

<template>
  <div class="session-stats">
    <Menu
      mode="content"
      class="session-stats__menu"
      :label="`上下文占用 ${percentText}，点击查看上下文统计`"
      content-label="上下文统计"
    >
      <template #trigger>
        <span class="session-stats__summary-context">
          <RingProgress class="session-stats__ring" :class="ringClass" :value="percent" :max="100" :size="16" :stroke-width="2.5" label="上下文占用" aria-hidden="true" />
          <span>上下文 {{ percentText }}</span>
        </span>
      </template>
      <div class="stats-panel stats-panel--context">
        <div class="stats-panel__head">
          <span class="stats-panel__heading"><Icon name="layers" :size="15" />上下文</span>
          <span v-if="contextApproximate" class="stats-panel__badge">估算</span>
        </div>
        <div class="stats-panel__hero">
          <div class="stats-panel__ring">
            <RingProgress :class="ringClass" :value="percent" :max="100" :size="92" :stroke-width="8" label="上下文占用" />
            <span class="stats-panel__percent">{{ percentText }}</span>
          </div>
          <div class="stats-panel__context">
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
      </div>
    </Menu>

    <i class="session-stats__separator" aria-hidden="true"></i>

    <Menu
      mode="content"
      class="session-stats__menu"
      :label="`${formatTokens(total, usageApproximate)} tokens${cacheTokens ? `，缓存命中 ${cacheHitText}%` : ''}，点击查看 token 用量`"
      content-label="Token 用量"
    >
      <template #trigger>
        <span class="session-stats__summary-item"><Icon name="database" :size="14" />{{ formatTokens(total, usageApproximate) }} tokens<template v-if="cacheTokens"><span class="session-stats__cache-hit"> · 缓存命中 {{ cacheHitText }}%</span></template></span>
      </template>
      <div class="stats-panel stats-panel--usage">
        <div class="stats-panel__head">
          <span class="stats-panel__heading"><Icon name="database" :size="15" />Token 用量</span>
          <span v-if="usageApproximate" class="stats-panel__badge">估算</span>
        </div>
        <template v-if="hasUsage">
          <div class="stats-panel__usage-head">
            <span class="stats-panel__heading"><Icon name="activity" :size="15" />用量走势</span>
            <strong>{{ formatTokens(total, usageApproximate) }} <small>tokens</small></strong>
          </div>
          <div v-if="trendBars.length > 1" class="stats-panel__chart" role="img" :aria-label="`${trendLabel} ${trendBars.length} 次的输入、输出和缓存 token`">
            <div class="stats-panel__chart-grid" aria-hidden="true"><i></i><i></i></div>
            <div class="stats-panel__bars">
              <span v-for="bar in trendBars" :key="bar.key" class="stats-panel__bar" :style="{ height: `${bar.scale}%` }" :title="bar.title">
                <i class="is-output" :style="{ flex: bar.output || 0.001 }"></i>
                <i class="is-input" :style="{ flex: bar.fresh || 0.001 }"></i>
                <i v-if="bar.cache" class="is-cache" :style="{ flex: bar.cache }"></i>
              </span>
            </div>
          </div>
          <div v-else class="stats-panel__stack" aria-hidden="true">
            <span class="is-input" :style="{ width: `${shares.input}%` }"></span>
            <span class="is-cache" :style="{ width: `${shares.cache}%` }"></span>
            <span class="is-output"></span>
          </div>
          <div class="stats-panel__chart-caption">
            <span>{{ trendLabel }} · {{ trendBars.length || 1 }} 次</span>
            <span>最高 {{ formatTokens(trendMax, usageApproximate) }}</span>
          </div>
          <div class="stats-panel__legend">
            <span class="stats-panel__legend-item is-input"><Icon name="input" :size="13" />输入 {{ formatTokens(usage.input, usageApproximate) }}</span>
            <span class="stats-panel__legend-item is-output"><Icon name="output" :size="13" />输出 {{ formatTokens(usage.output, usageApproximate) }}</span>
            <span
              v-if="cacheTokens"
              class="stats-panel__legend-item is-cache"
              :title="`缓存读取 ${formatTokens(cacheTokens, usageApproximate)} tokens，占输入 ${cacheHit}%`"
            ><Icon name="cache-read" :size="13" />缓存读 {{ cacheHit }}%</span>
            <span
              v-if="cacheWriteTokens"
              class="stats-panel__legend-item is-cache-write"
              :title="`缓存写入 ${formatTokens(cacheWriteTokens, usageApproximate)} tokens`"
            ><Icon name="cache-write" :size="13" />缓存写 {{ formatTokens(cacheWriteTokens, usageApproximate) }}</span>
          </div>
          <div v-if="usage.reasoning" class="stats-panel__chips">
            <div class="stats-panel__chip">
              <span class="stats-panel__chip-icon"><Icon name="idea" :size="14" /></span>
              <strong>{{ formatTokens(usage.reasoning, usageApproximate) }}</strong>
              <small>推理</small>
            </div>
          </div>
        </template>
        <p v-else class="stats-panel__note">这个会话还没有可统计的用量。</p>
      </div>
    </Menu>

    <template v-if="speed">
      <i class="session-stats__separator session-stats__separator--speed" aria-hidden="true"></i>
      <Menu
        mode="content"
        class="session-stats__menu session-stats__menu--speed"
        :label="`生成速度 ${speed}，点击查看速度统计`"
        content-label="生成速度"
      >
        <template #trigger>
          <span class="session-stats__summary-item"><Icon name="gauge" :size="14" />{{ speed }}</span>
        </template>
        <div class="stats-panel stats-panel--speed">
          <div class="stats-panel__head">
            <span class="stats-panel__heading"><Icon name="gauge" :size="15" />生成速度</span>
            <span class="stats-panel__hint">按平均耗时从慢到快</span>
          </div>
          <table v-if="speedGroups.length" class="stats-panel__speed-table">
            <thead>
              <tr><th>模型 / 供应商</th><th>首字</th><th>耗时</th><th>tok/s</th></tr>
            </thead>
            <tbody>
              <tr v-for="group in speedGroups" :key="`${group.provider}-${group.model}`">
                <td class="stats-panel__speed-model" :title="`${group.provider} / ${group.model}`">
                  <strong>{{ group.model }}</strong>
                  <small>{{ group.provider }} · {{ group.count }} 次</small>
                </td>
                <td>{{ group.averageFirstTokenMs ? formatDuration(group.averageFirstTokenMs) : '—' }}</td>
                <td :class="{ 'is-slow': isSlow(group) }">{{ group.averageDurationMs ? formatDuration(group.averageDurationMs) : '—' }}</td>
                <td :class="{ 'is-slow': isSlow(group) }">{{ group.averageTps ? Math.round(group.averageTps) : '—' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="stats-panel__note">还没有足够的请求耗时数据。</p>
          <p class="stats-panel__note">首字、耗时都是平均每次请求；慢于整体平均 20% 的模型会标黄。</p>
        </div>
      </Menu>
    </template>

    <span v-if="approximate" class="session-stats__summary-estimate">估算</span>
  </div>
</template>

<style scoped lang="scss" src="../../styles/components/activity/StatsPanel.scss"></style>
