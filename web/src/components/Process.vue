<!--
一段“模型没说话”的过程：本次请求、思考、工具调用按发生顺序排成一列。
执行中展开、执行完收成一行；有失败的工具就保持展开；用户手动点过以用户为准。
只有一条请求（模型直接说话）时不需要折叠，直接显示那一条 RequestStatus。
调用示例：<component :is="Components.Process" :steps="steps" :live="true" />
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { Components } from '../Extension'
import type { Step } from './History.vue'

const props = defineProps<{ steps: Step[]; live: boolean }>()
const manual = ref<boolean | null>(null)
const failed = computed(() => props.steps.some(step => step.kind === 'tool' && step.state === 'failed'))
const open = computed(() => manual.value ?? (props.live || failed.value))
const single = computed(() => props.steps.length === 1 && props.steps[0]!.kind === 'request')

// 收起时的一行概括：进行中说正在做什么，结束后说做了什么、用了多久。
const summary = computed(() => {
  const tools = props.steps.filter(step => step.kind === 'tool')
  if (props.live) {
    const step = props.steps.findLast(item => item.kind !== 'request' || item.live || item.retry) ?? props.steps.at(-1)!
    if (step.kind === 'thinking') return '正在思考'
    if (step.kind === 'tool') return { writing: `正在写 ${step.name} 调用`, waiting: `准备运行 ${step.name}`, running: `正在运行 ${step.name}` }[step.state as 'writing'] ?? '处理中'
    return step.kind === 'request' && step.retry ? '等待重试' : '正在请求模型'
  }
  const ms = props.steps.reduce((sum, step) => sum + (step.kind === 'request' ? step.request?.duration ?? 0 : 0), 0)
  const time = ms < 60000 ? `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s` : `${Math.floor(ms / 60000)}m ${Math.round(ms % 60000 / 1000)}s`
  const parts = [`处理了 ${time}`]
  if (props.steps.some(step => step.kind === 'thinking')) parts.push('思考')
  if (tools.length) parts.push(`${tools.length} 个工具${failed.value ? `（${tools.filter(step => step.kind === 'tool' && step.state === 'failed').length} 个失败）` : ''}`)
  return parts.join(' · ')
})
</script>

<template>
  <div v-if="single" class="process process--single">
    <component :is="Components.RequestStatus" :step="steps[0]" />
  </div>
  <div v-else class="process" :class="{ 'is-open': open, 'is-live': live }">
    <button class="process__head" type="button" :aria-expanded="open" @click="manual = !open">
      <span class="process__summary" :class="{ shimmer: live }">{{ summary }}</span>
      <svg class="process__chevron" viewBox="0 0 16 16" width="14" height="14"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>
    <div class="process__fold">
      <div class="process__body">
        <template v-for="step in steps" :key="step.key">
          <component :is="Components.RequestStatus" v-if="step.kind === 'request'" :step="step" />
          <component :is="Components.Thinking" v-else-if="step.kind === 'thinking'" :text="step.text" :live="step.live" />
          <component :is="Components.ToolCall" v-else :step="step" />
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.process__head { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0; border: 0; background: none; color: var(--muted); font: inherit; font-size: 14px; cursor: pointer; }
.process__head:hover { color: var(--text); }
.process__chevron { transition: transform .2s ease; }
.is-open .process__chevron { transform: rotate(90deg); }
.process__fold { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .25s ease; }
.is-open .process__fold { grid-template-rows: 1fr; }
.process__body { overflow: hidden; display: flex; flex-direction: column; gap: 2px; margin-left: 6px; padding-left: 14px; border-left: 1px solid var(--line); }
.is-open .process__body { margin-top: 6px; }
.shimmer { background: linear-gradient(90deg, var(--muted) 0%, var(--muted) 40%, var(--text) 50%, var(--muted) 60%, var(--muted) 100%); background-size: 300% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: shimmer 2.2s linear infinite; }
@keyframes shimmer { from { background-position: 100% 0; } to { background-position: 0 0; } }
</style>
