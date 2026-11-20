<!--
输入框下面的一行：既是状态也是操作。
左边是当前模型，点开选模型；当前模型支持思考强度时，强度也在这个面板里。
右边把历史里每条 request.usage 加起来成总用量（哪一项从没报过就显示“无”）；上下文占用点开后可以手动压缩。
调用示例：<component :is="Components.Stats" />
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { RequestRecord } from '@kernel4632/agent-core'
import { HugeiconsIcon as Icon } from '@hugeicons/vue'
import { AiBrain01Icon, ArrowDown01Icon, ArrowDown02Icon, ArrowUp02Icon, Database01Icon, Idea01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { Agent } from '../Agent'

const panel = ref<'model' | 'context' | null>(null)
const root = ref<HTMLElement>()
const efforts: Record<string, string> = { minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '极高' }
const model = computed(() => Agent.state.models.find(item => item.id === Agent.state.model))
const tokens = (value?: number) => value === undefined ? '无' : value >= 1e6 ? `${(value / 1e6).toFixed(1).replace(/\.0$/, '')}M` : value >= 1000 ? `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(value)

const requests = computed(() => Agent.state.history.flatMap(message => 'request' in message && message.role !== 'error' && message.request ? [message.request as RequestRecord] : []))
const total = computed(() => {
  const sum = (key: 'input' | 'output' | 'cacheRead') => requests.value.some(request => request.usage?.[key] !== undefined)
    ? requests.value.reduce((value, request) => value + (request.usage?.[key] ?? 0), 0) : undefined
  return { input: sum('input'), output: sum('output'), cache: sum('cacheRead') }
})
// 当前上下文：最近一次普通请求的输入 + 输出；压缩之后还没有新请求时如实说不知道。
const context = computed(() => {
  const history = Agent.state.history
  const index = history.findLastIndex(message => message.role === 'assistant' || message.role === 'compact')
  const message = history[index]
  const usage = message?.role === 'assistant' ? message.request?.usage : undefined
  const used = usage?.input === undefined ? undefined : usage.input + (usage.output ?? 0)
  const limit = model.value?.context
  return { used, limit, percent: used !== undefined && limit ? Math.min(100, used / limit * 100) : undefined, compacted: message?.role === 'compact' }
})

function choose(id: string) { Agent.configure({ model: id }) }
function compact() { panel.value = null; Agent.compact() }
const close = (event: PointerEvent) => { if (!root.value?.contains(event.target as Node)) panel.value = null }
onMounted(() => document.addEventListener('pointerdown', close))
onBeforeUnmount(() => document.removeEventListener('pointerdown', close))
</script>

<template>
  <div ref="root" class="stats">
    <button class="stats__model" type="button" title="模型与思考强度" :aria-expanded="panel === 'model'" @click="panel = panel === 'model' ? null : 'model'">
      <Icon :icon="AiBrain01Icon" :size="16" />
      <span>{{ model?.name ?? Agent.state.model }}</span>
      <span v-if="Agent.state.effort && model?.efforts" class="stats__effort" title="思考强度"><Icon :icon="Idea01Icon" :size="14" />{{ efforts[Agent.state.effort] ?? Agent.state.effort }}</span>
      <Icon :icon="ArrowDown01Icon" :size="14" />
    </button>
    <span class="stats__usage" title="本次对话累计用量">
      <span title="输入 token"><Icon :icon="ArrowUp02Icon" :size="14" />{{ tokens(total.input) }}</span>
      <span title="输出 token"><Icon :icon="ArrowDown02Icon" :size="14" />{{ tokens(total.output) }}</span>
      <span title="缓存命中 token"><Icon :icon="Database01Icon" :size="14" />{{ tokens(total.cache) }}</span>
    </span>
    <button class="stats__context" type="button" title="上下文占用（点开可压缩）" :aria-expanded="panel === 'context'" @click="panel = panel === 'context' ? null : 'context'">
      <svg viewBox="0 0 20 20" width="16" height="16"><circle cx="10" cy="10" r="7" fill="none" stroke="var(--ghost)" stroke-width="2.2" /><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" pathLength="100" :stroke-dasharray="`${context.percent ?? 0} 100`" transform="rotate(-90 10 10)" /></svg>
      <span>{{ context.percent === undefined ? '无' : `${Math.round(context.percent)}%` }}</span>
    </button>

    <div v-if="panel === 'model'" class="stats__panel stats__panel--left" role="menu">
      <button v-for="item in Agent.state.models" :key="item.id" class="stats__option" type="button" role="menuitemradio" :aria-checked="item.id === Agent.state.model" @click="choose(item.id)">
        <span>{{ item.name }}</span>
        <Icon v-if="item.id === Agent.state.model" :icon="Tick02Icon" :size="16" />
      </button>
      <div v-if="model?.efforts" class="stats__efforts">
        <span><Icon :icon="Idea01Icon" :size="14" />思考强度</span>
        <div class="stats__segment">
          <button v-for="effort in model.efforts" :key="effort" type="button" :class="{ 'is-on': effort === Agent.state.effort }" @click="Agent.configure({ effort })">{{ efforts[effort] ?? effort }}</button>
        </div>
      </div>
    </div>
    <div v-if="panel === 'context'" class="stats__panel stats__panel--right">
      <p class="stats__row"><span>上下文</span><b>{{ tokens(context.used) }} / {{ tokens(context.limit) }}</b></p>
      <div class="stats__bar"><i :style="{ width: `${context.percent ?? 0}%` }" /></div>
      <p class="stats__hint">{{ context.compacted ? '刚压缩过，下一次请求后显示新的占用' : '最近一次请求的输入加输出' }}</p>
      <button class="stats__compact" type="button" :disabled="Agent.state.running" @click="compact">压缩上下文</button>
    </div>
  </div>
</template>

<style scoped>
.stats { position: relative; display: flex; align-items: center; gap: 12px; height: 34px; padding: 0 8px 0 10px; font-size: 12.5px; color: var(--faint); }
.stats button { font: inherit; color: inherit; cursor: pointer; }
.stats__model, .stats__context { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 8px; border: 0; border-radius: 14px; background: none; }
.stats__model:hover, .stats__context:hover, [aria-expanded='true'] { background: var(--hover); color: var(--text); }
.stats__model { margin-left: -8px; color: var(--muted); }
.stats__effort { display: inline-flex; align-items: center; gap: 2px; color: var(--faint); }
.stats__usage { display: flex; gap: 10px; margin-left: auto; overflow: hidden; white-space: nowrap; color: var(--faint); font-variant-numeric: tabular-nums; }
.stats__usage > span { display: inline-flex; align-items: center; gap: 2px; }
.stats__context { margin-right: -8px; font-variant-numeric: tabular-nums; }
.stats__panel { position: absolute; bottom: calc(100% + 6px); z-index: 5; width: 280px; padding: 6px; border: 1px solid var(--line); border-radius: 18px; background: var(--pane); box-shadow: 0 12px 32px -12px rgba(30, 25, 15, .25); }
.stats__panel--left { left: 0; }
.stats__panel--right { right: 0; padding: 14px 16px 16px; }
.stats__option { display: flex; align-items: center; justify-content: space-between; width: 100%; height: 40px; padding: 0 12px; border: 0; border-radius: 12px; background: none; color: var(--text) !important; font-size: 14px !important; }
.stats__option:hover { background: var(--hover); }
.stats__efforts { margin-top: 6px; padding: 10px 12px 8px; border-top: 1px solid var(--line); }
.stats__efforts > span { display: flex; align-items: center; gap: 4px; margin-bottom: 8px; font-size: 12px; color: var(--muted); }
.stats__segment { display: flex; padding: 3px; border-radius: 12px; background: var(--soft); }
.stats__segment button { flex: 1; height: 28px; border: 0; border-radius: 9px; background: none; font-size: 13px; color: var(--muted); }
.stats__segment .is-on { background: var(--pane); color: var(--text); box-shadow: 0 1px 3px rgba(0, 0, 0, .08); }
.stats__row { display: flex; justify-content: space-between; margin: 0 0 10px; font-size: 13px; }
.stats__row b { font-weight: 500; color: var(--text); font-variant-numeric: tabular-nums; }
.stats__bar { height: 6px; border-radius: 3px; background: var(--soft); overflow: hidden; }
.stats__bar i { display: block; height: 100%; border-radius: 3px; background: var(--text); }
.stats__hint { margin: 10px 0 14px; font-size: 12px; color: var(--faint); }
.stats__compact { width: 100%; height: 36px; border: 0; border-radius: 18px; background: var(--primary); color: var(--on-primary) !important; font-size: 13.5px !important; }
.stats__compact:hover:enabled { opacity: .88; }
.stats__compact:disabled { opacity: .45; cursor: default !important; }
</style>
