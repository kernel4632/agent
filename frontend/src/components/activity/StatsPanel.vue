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
const formatTokens = (value, isApproximate = false) => {
  const number = Number(value || 0)
  const prefix = isApproximate ? '~' : ''
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
// 外显速度：生成中看当前输出 / 首字后耗时；结束后看最后一次请求的实际速度。
const speed = computed(() => {
  if (live.value.running) {
    const firstTokenAt = Number(live.value.firstTokenAt || 0)
    const output = Number(live.value.output || 0)
    if (firstTokenAt && output) {
      const elapsed = (liveNow.value - firstTokenAt) / 1000
      if (elapsed > 0) return `${Math.max(1, Math.round(output / elapsed))} tok/s`
    }
  }
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
const requestCount = computed(() => Number(usage.value.requests || 0) || (props.stats.series || []).length)
const content = computed(() => props.stats.composition || { user: 0, thinking: 0, reply: 0, tools: 0, total: 0 })
const contentTotal = computed(() => Number(content.value.total || 0))
const contentShares = computed(() => {
  const sum = contentTotal.value
  if (!sum) return { user: 0, thinking: 0, reply: 0, tools: 0 }
  return {
    user: content.value.user / sum * 100,
    thinking: content.value.thinking / sum * 100,
    reply: content.value.reply / sum * 100,
    tools: content.value.tools / sum * 100,
  }
})
// 走势图已移除：Token 面板只保留总账和构成，不再用一条几乎不变的上下文曲线占空间。
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
      class="session-stats__menu session-stats__menu--usage"
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
          <div class="stats-panel__overview">
            <div class="stats-panel__overview-total">
              <span class="stats-panel__overview-label">本会话累计</span>
              <div class="stats-panel__overview-value"><strong>{{ formatTokens(total, usageApproximate) }}</strong><span>tokens</span></div>
            </div>
            <span class="stats-panel__overview-count">{{ requestCount }} 次请求<template v-if="usage.reasoning"> · 推理 {{ formatTokens(usage.reasoning, usageApproximate) }}</template></span>
          </div>
          <div class="stats-panel__metric-row">
            <div class="stats-panel__metric is-input"><span>输入</span><strong>{{ formatTokens(usage.input, usageApproximate) }}</strong></div>
            <div class="stats-panel__metric is-output"><span>输出</span><strong>{{ formatTokens(usage.output, usageApproximate) }}</strong></div>
            <div class="stats-panel__metric is-cache"><span>缓存读</span><strong>{{ formatTokens(cacheTokens, usageApproximate) }}</strong><em>{{ cacheHit }}%</em></div>
            <div v-if="cacheWriteTokens" class="stats-panel__metric is-cache-write"><span>缓存写</span><strong>{{ formatTokens(cacheWriteTokens, usageApproximate) }}</strong></div>
          </div>

          <div v-if="contentTotal" class="stats-panel__composition">
            <div class="stats-panel__composition-head"><span>内容构成 · 估算</span><span>{{ formatTokens(contentTotal, usageApproximate) }} tokens</span></div>
            <div class="stats-panel__stack stats-panel__stack--composition stats-panel__stack--content" aria-hidden="true">
              <span class="is-user" :style="{ flex: `0 0 ${contentShares.user}%` }"></span>
              <span class="is-thinking" :style="{ flex: `0 0 ${contentShares.thinking}%` }"></span>
              <span class="is-reply" :style="{ flex: `0 0 ${contentShares.reply}%` }"></span>
              <span class="is-tools" :style="{ flex: `0 0 ${contentShares.tools}%` }"></span>
            </div>
            <div class="stats-panel__composition-legend">
              <span><i class="is-user"></i>用户输入 {{ formatTokens(content.user, usageApproximate) }}</span>
              <span><i class="is-thinking"></i>助手思考 {{ formatTokens(content.thinking, usageApproximate) }}</span>
              <span><i class="is-reply"></i>助手回复 {{ formatTokens(content.reply, usageApproximate) }}</span>
              <span><i class="is-tools"></i>工具输出 {{ formatTokens(content.tools, usageApproximate) }}</span>
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
