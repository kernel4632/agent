<!--
一次模型请求：只在 request-start 真正到达后出现。
进行中：转圈、模型、是否已收到首字、计时；失败待重试：原因和倒计时；结束后：首字、耗时、输入 / 输出 / 缓存 token。
每一项用图标表示，悬停看含义。数据读消息上的 request，随历史保存；没报的用量显示“无”，不当 0。
调用示例：<component :is="Components.RequestStatus" :step="{ kind: 'request', key, request }" />
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Icon from './Icon.vue'
import { AiBrain01Icon, Alert02Icon, ArchiveIcon, ArrowDown02Icon, ArrowUp02Icon, Clock01Icon, Database01Icon, FlashIcon } from '@hugeicons/core-free-icons'
import type { Step } from './History.vue'

const props = defineProps<{ step: Extract<Step, { kind: 'request' }> }>()
const now = ref(Date.now())
const open = ref(false)
let timer = 0
// 只在“进行中 / 等重试”时走表；step 对象每次推送都会换新，所以只看这个布尔值。
watch(() => Boolean(props.step.live || props.step.retry), active => {
  clearInterval(timer)
  now.value = Date.now()
  if (active) timer = window.setInterval(() => { now.value = Date.now() }, 250)
}, { immediate: true })
onBeforeUnmount(() => clearInterval(timer))

const seconds = (ms: number) => ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
const tokens = (value?: number) => value === undefined ? '无' : value >= 1000 ? `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(value)
const errors = computed(() => props.step.errors ?? [])
const tone = computed(() => props.step.live ? 'live' : props.step.retry ? 'retry' : errors.value.length ? 'failed' : 'done')
const compact = computed(() => props.step.compact || props.step.live?.compact)
const model = computed(() => props.step.live?.model ?? props.step.request?.model ?? '')

// 结束（或进行中）的各项指标：图标、值、含义（悬停提示）。
type Fact = { icon: typeof FlashIcon; value: string; meaning: string }
const fact = (icon: typeof FlashIcon, value: string, meaning: string): Fact => ({ icon, value, meaning })
const facts = computed((): Fact[] => {
  const { live, request } = props.step
  if (live) return [fact(FlashIcon, live.first ? seconds(live.first) : '…', '首字'), fact(Clock01Icon, seconds(now.value - live.start), '已用时间')]
  if (!request) return []
  const usage = request.usage
  return [...(request.first !== undefined ? [fact(FlashIcon, seconds(request.first), '首字')] : []), fact(Clock01Icon, seconds(request.duration), '总耗时'),
    fact(ArrowUp02Icon, tokens(usage?.input), '输入 token'), fact(ArrowDown02Icon, tokens(usage?.output), '输出 token'), fact(Database01Icon, tokens(usage?.cacheRead), '缓存命中 token')]
})
const problem = computed(() => props.step.retry
  ? `${Math.max(0, Math.ceil((props.step.retry.until - now.value) / 1000))}s 后第 ${props.step.retry.attempt + 1} 次尝试`
  : `失败 ${errors.value.length} 次，已自动重试`)
</script>

<template>
  <div class="request" :class="`is-${tone}`">
    <button class="request__line" type="button" :disabled="!errors.length" :title="compact ? '压缩请求' : '模型请求'" @click="open = !open">
      <span v-if="tone === 'live'" class="spinner" />
      <Icon v-else-if="errors.length" :icon="Alert02Icon" :size="16" />
      <Icon v-else :icon="compact ? ArchiveIcon : AiBrain01Icon" :size="16" />
      <template v-if="errors.length && !step.live">
        <span class="request__problem">{{ problem }}</span>
        <span class="request__reason">{{ errors.at(-1)!.content }}</span>
      </template>
      <template v-else>
        <span class="request__model">{{ model }}<template v-if="step.live && step.live.attempt > 1"> · 第 {{ step.live.attempt }} 次</template></span>
        <span v-for="item in facts" :key="item.meaning" class="request__fact" :title="item.meaning"><Icon :icon="item.icon" :size="14" />{{ item.value }}</span>
      </template>
    </button>
    <pre v-if="open" class="request__error">{{ errors.map(error => error.content).join('\n') }}</pre>
  </div>
</template>

<style scoped>
.request__line { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 32px; padding: 0; border: 0; background: none; font: inherit; font-size: 13px; color: var(--faint); text-align: left; cursor: default; overflow: hidden; white-space: nowrap; font-variant-numeric: tabular-nums; }
.request__line:enabled { cursor: pointer; }
.request__line > svg { flex: none; }
.is-done .request__line, .is-live .request__line { flex-wrap: wrap; }
.request__model { flex: none; color: var(--muted); }
.is-live .request__model { color: var(--text); }
.request__fact { display: inline-flex; align-items: center; gap: 4px; flex: none; }
.request__problem { flex: none; color: var(--warn); }
.is-retry > .request__line > svg, .is-failed > .request__line > svg { color: var(--warn); }
.request__reason { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.request__error { margin: 2px 0 8px 26px; padding: 10px 12px; border-radius: 12px; background: var(--soft); color: var(--muted); font: 12px/1.6 var(--mono); white-space: pre-wrap; }
</style>
