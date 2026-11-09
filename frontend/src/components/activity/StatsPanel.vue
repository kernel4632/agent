<!--
输入框下方的会话状态：展示上下文、token 与速度；每一项独立展开自己的面板。
真实请求数据优先；旧会话缺少记录时显示“估算”。
调用示例：<StatsPanel :stats="stats" />。
-->
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
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
const estimate = computed(() => context.value.estimate || null)
const estimatePercent = computed(() => {
  if (!estimate.value) return 0
  const budget = Number(estimate.value.budget || context.value.limit || 0)
  if (!budget) return 0
  return Math.max(0, Number(estimate.value.tokens || 0) / budget * 100)
})
const estimateClass = computed(() => estimatePercent.value >= 100
  ? 'is-danger'
  : estimatePercent.value >= threshold.value ? 'is-warn' : '')
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
const cacheRead = computed(() => Math.min(Number(usage.value.input || 0), cacheTokens.value))
const uncachedInput = computed(() => Math.max(0, Number(usage.value.input || 0) - cacheRead.value))
// 底栏显示一位小数，面板保留整数；100% 不显示成 100.0%。
const cacheHitText = computed(() => {
  const input = Number(usage.value.input || 0)
  if (!input) return '0'
  const percent = Math.min(100, cacheTokens.value / input * 100)
  return percent >= 100 ? '100' : percent.toFixed(1).replace(/\.0$/, '')
})
const formatTokens = (value, isApproximate = false) => {
  const number = Number(value || 0)
  const prefix = isApproximate ? '~' : ''
  if (number >= 1_000_000_000) return `${prefix}${(number / 1_000_000_000).toFixed(1)}B`
  if (number >= 1_000_000) return `${prefix}${(number / 1_000_000).toFixed(1)}M`
  if (number >= 1000) return `${prefix}${(number / 1000).toFixed(1)}K`
  return `${prefix}${number}`
}
const live = computed(() => props.stats.live || {})
const liveNow = ref(Date.now())
let liveTimer = null
watch(() => Boolean(live.value.running), running => {
  if (liveTimer) { window.clearInterval(liveTimer); liveTimer = null }
  if (!running) return
  liveNow.value = Date.now()
  liveTimer = window.setInterval(() => { liveNow.value = Date.now() }, 500)
}, { immediate: true })
onBeforeUnmount(() => { if (liveTimer) window.clearInterval(liveTimer) })
// 实时速度用最近两秒的估算输出做滑动窗口；首字刚到时不拿极小分母硬算，
// 先沿用上一次真实请求的速度，避免瞬间冲出一千多 tok/s。
const liveSamples = ref([])
let lastLiveOutput = -1
watch([() => live.value.running, () => Number(live.value.firstTokenAt || 0), () => Number(live.value.startedAt || 0)], () => {
  liveSamples.value = []
  lastLiveOutput = -1
})
watch([() => Boolean(live.value.running), () => Number(live.value.output || 0), liveNow], ([running, output]) => {
  if (!running || output <= 0) {
    liveSamples.value = []
    lastLiveOutput = -1
    return
  }
  if (output < lastLiveOutput) liveSamples.value = []
  lastLiveOutput = output
  const at = liveNow.value
  liveSamples.value = [...liveSamples.value.filter(sample => at - sample.at <= 2000), { at, tokens: output }]
})
const liveRate = computed(() => {
  if (!live.value.running || liveSamples.value.length < 2) return 0
  const first = liveSamples.value[0]
  const last = liveSamples.value.at(-1)
  const seconds = (last.at - first.at) / 1000
  if (seconds < 0.8) return 0
  return Math.max(0, (last.tokens - first.tokens) / seconds)
})
// 外显速度：生成中用最近两秒的滑动窗口；结束后用最后一次真实请求。
const speed = computed(() => {
  if (live.value.running && liveRate.value > 0) return `${Math.round(liveRate.value)} tok/s`
  const latestTps = Number(live.value.tps || 0)
  if (latestTps > 0) return `${Math.round(latestTps)} tok/s`
  // 旧会话或最后一笔没有耗时数据时，至少保留一个聚合速度，不能让速度项直接消失。
  const output = Number(usage.value.output || 0)
  const duration = Number(usage.value.durationMs || 0)
  return output > 0 && duration > 0 ? `${Math.round(output / (duration / 1000))} tok/s` : ''
})
const ringClass = computed(() => ({
  'is-warn': percent.value >= 70 && percent.value < 90,
  'is-danger': percent.value >= 90,
}))
const hasUsage = computed(() => total.value > 0)
// 走势图已移除：Token 面板只保留总账和构成，不再用一条几乎不变的上下文曲线占空间。
const speedGroups = computed(() => [...(props.stats.models || [])].sort((a, b) => (b.averageDurationMs - a.averageDurationMs) || (a.averageTps - b.averageTps)))
const liveHighlight = computed(() => {
  if (!live.value.running) return null
  const firstTokenAt = Number(live.value.firstTokenAt || 0)
  const startedAt = Number(live.value.startedAt || 0)
  const provider = live.value.provider || '生成中'
  const model = live.value.model || ''
  const measured = group => Boolean(group.lastDurationMs || group.lastFirstTokenMs || group.lastTps)
  const previous = speedGroups.value.find(group => group.provider === provider && group.model === model && measured(group))
    || speedGroups.value.find(measured)
  // “正在请求模型”阶段还没有本轮首字和速度，先原样显示最近一次测到的值。
  if (!firstTokenAt) return previous ? { ...previous, lastAt: Number.MAX_SAFE_INTEGER, live: true } : null
  return {
    provider,
    model,
    lastFirstTokenMs: startedAt ? Math.max(0, firstTokenAt - startedAt) : previous?.lastFirstTokenMs || 0,
    lastTps: liveRate.value || previous?.lastTps || 0,
    lastAt: Number.MAX_SAFE_INTEGER,
    live: true,
  }
})
// 一个会话可以换几十个模型；小面板用紧凑表格只展示最近使用且有测量值的五个。
const recentSpeedGroups = computed(() => [...speedGroups.value]
  .filter(group => group.lastDurationMs || group.lastFirstTokenMs || group.lastTps)
  .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0) || (b.averageDurationMs - a.averageDurationMs)))
const recentSpeedHighlights = computed(() => {
  const groups = recentSpeedGroups.value.slice(0, 5)
  const liveGroup = liveHighlight.value
  if (!liveGroup) return groups
  const index = groups.findIndex(group => group.provider === liveGroup.provider && group.model === liveGroup.model)
  if (index < 0) return [liveGroup, ...groups].slice(0, 5)
  // 等待首字时还没有本次的耗时数据，先沿用这个模型上一次测到的值；
  // 首字到达后再覆盖成这一轮的实时值，避免面板在“正在请求模型”时变成破折号。
  return groups.map((group, position) => position === index
    ? {
        ...group,
        lastFirstTokenMs: liveGroup.lastFirstTokenMs || group.lastFirstTokenMs,
        lastTps: liveGroup.lastTps || group.lastTps,
        live: true,
      }
    : group)
})
const formatDuration = value => {
  const ms = Number(value || 0)
  if (!ms) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  return `${Math.floor(seconds / 60)}m${Math.round(seconds % 60)}s`
}
// 首字越快越绿；tok/s 越高越绿。没有数据保持灰色。
const firstTone = ms => !ms ? 'is-muted' : ms <= 3000 ? 'is-fast' : ms <= 10000 ? 'is-warn' : 'is-slow'
const tpsTone = tps => !tps ? 'is-muted' : tps >= 30 ? 'is-fast' : tps >= 10 ? 'is-warn' : 'is-slow'
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
        <span v-if="contextApproximate" class="stats-panel__badge stats-panel__badge--floating">估算</span>
        <div class="stats-panel__hero">
          <div class="stats-panel__ring">
            <RingProgress :class="ringClass" :value="percent" :max="100" :size="92" :stroke-width="8" label="上下文占用" />
            <RingProgress
              v-if="estimate"
              class="stats-panel__ring-estimate"
              :class="estimateClass"
              :value="estimatePercent"
              :max="100"
              :size="92"
              :stroke-width="8"
              label="预估上下文占用"
              aria-hidden="true"
            />
            <span class="stats-panel__percent">{{ percentText }}</span>
          </div>
          <div class="stats-panel__context">
            <div class="stats-panel__value">
              <strong>{{ formatTokens(context.used, contextApproximate) }}</strong>
              <span>/ {{ formatTokens(context.limit) }}</span>
              <span v-if="estimate" class="stats-panel__estimate">（估算 {{ formatTokens(estimate.tokens) }}）</span>
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
      class="session-stats__menu session-stats__menu--usage"
      :label="`${formatTokens(total, usageApproximate)} tokens${cacheTokens ? `，缓存命中 ${cacheHitText}%` : ''}，点击查看 token 用量`"
      content-label="Token 用量"
      content-class="stats-panel-menu--usage"
      :content-style="{ width: '300px' }"
    >
      <template #trigger>
        <span class="session-stats__summary-item"><Icon name="database" :size="14" />{{ formatTokens(total, usageApproximate) }} tokens<template v-if="cacheTokens"><span class="session-stats__cache-hit"> · 缓存命中 {{ cacheHitText }}%</span></template></span>
      </template>
      <div class="stats-panel stats-panel--usage stats-panel--usage-simple">
        <div class="stats-panel__simple-head">
          <span class="stats-panel__simple-title"><Icon name="database" :size="18" />Token 用量</span>
          <strong class="stats-panel__simple-total">{{ formatTokens(total, usageApproximate) }} <small>tok</small></strong>
        </div>
        <div class="stats-panel__simple-rule"></div>
        <template v-if="hasUsage">
          <div class="stats-panel__simple-rows">
            <div class="stats-panel__simple-row is-cache-hit"><span class="stats-panel__simple-label"><span class="stats-panel__simple-icon"><Icon name="flash" :size="14" /></span>缓存命中</span><strong>{{ cacheHitText }}%</strong></div>
            <div class="stats-panel__simple-row is-uncached"><span class="stats-panel__simple-label"><span class="stats-panel__simple-icon"><Icon name="input" :size="14" /></span>未缓存输入</span><strong>{{ formatTokens(uncachedInput, usageApproximate) }} tok</strong></div>
            <div class="stats-panel__simple-row is-cache-read"><span class="stats-panel__simple-label"><span class="stats-panel__simple-icon"><Icon name="cache-read" :size="14" /></span>缓存读取</span><strong>{{ formatTokens(cacheRead, usageApproximate) }} tok</strong></div>
            <div class="stats-panel__simple-row is-output"><span class="stats-panel__simple-label"><span class="stats-panel__simple-icon"><Icon name="output" :size="14" /></span>输出</span><strong>{{ formatTokens(usage.output, usageApproximate) }} tok</strong></div>
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
        :content-style="{ width: 'max-content', maxWidth: 'calc(100vw - 24px)' }"
      >
        <template #trigger>
          <span class="session-stats__summary-item"><Icon name="gauge" :size="14" />{{ speed }}</span>
        </template>
        <div class="stats-panel stats-panel--speed-simple">
          <div v-if="recentSpeedHighlights.length" class="stats-panel__speed-table-wrap">
            <table class="stats-panel__speed-grid">
              <colgroup><col><col style="width: 46px"><col style="width: 72px"></colgroup>
              <tbody>
                <tr v-for="group in recentSpeedHighlights" :key="`${group.provider}-${group.model}`" class="stats-panel__speed-row" :class="{ 'is-live': group.live }" :title="group.live ? `正在生成：${group.provider}/${group.model}` : `${group.provider}/${group.model}`">
                  <td class="stats-panel__speed-model-cell">
                    <span class="stats-panel__speed-model-path"><span>{{ group.provider }}</span><i>/</i><strong>{{ group.model }}</strong></span>
                  </td>
                  <td class="stats-panel__speed-first" :class="firstTone(group.lastFirstTokenMs)">{{ formatDuration(group.lastFirstTokenMs) }}</td>
                  <td class="stats-panel__speed-tps" :class="tpsTone(group.lastTps)"><span class="stats-panel__speed-tps-inner"><span>{{ group.lastTps ? Math.round(group.lastTps) : '—' }}</span><small>tok/s</small></span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="stats-panel__note">还没有足够的请求耗时数据。</p>
        </div>
      </Menu>
    </template>

    <span v-if="approximate" class="session-stats__summary-estimate">估算</span>
  </div>
</template>

<style scoped lang="scss" src="../../styles/components/activity/StatsPanel.scss"></style>
