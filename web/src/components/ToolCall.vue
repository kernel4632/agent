<!--
一次工具调用：模型一开始写调用就出现，参数边写边长；放行后转为运行中，实时输出往外冒，最后挂上结果。
收起时是一行（名字、参数摘要、状态）；失败自动展开，用户手动操作优先。
内容区可被扩展按工具名替换：ToolViews[toolName] 收到同一个 step。
调用示例：<component :is="Components.ToolCall" :step="step" />
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { ToolViews } from '../Extension'
import type { Step } from './History.vue'

const props = defineProps<{ step: Extract<Step, { kind: 'tool' }> }>()
const manual = ref<boolean | null>(null)
const open = computed(() => manual.value ?? props.step.state === 'failed')
const labels = { writing: '编写中', waiting: '等待运行', running: '运行中', done: '完成', failed: '失败', denied: '已拒绝', cancelled: '已取消' }

// 参数摘要：取第一个字符串参数；还在写的时候直接显示原始文字的尾巴；运行中有输出时显示最新一行。
const brief = computed(() => {
  if (props.step.state === 'running' && props.step.log) return props.step.log.trim().split('\n').at(-1)
  const input = props.step.input
  if (input && typeof input === 'object') return String(Object.values(input).find(value => typeof value === 'string') ?? JSON.stringify(input))
  return (props.step.raw ?? '').replace(/^\{"\w+":"?/, '').replace(/\\"/g, '"').slice(-120)
})
const args = computed(() => props.step.input === undefined ? props.step.raw ?? '' : JSON.stringify(props.step.input, null, 2))
const result = computed(() => {
  const output = props.step.output
  if (!output) return ''
  if (output.type === 'execution-denied') return output.reason ?? '已拒绝'
  return typeof output.value === 'string' ? output.value : JSON.stringify(output.value, null, 2)
})
</script>

<template>
  <div class="tool" :class="[`is-${step.state}`, { 'is-open': open }]">
    <button class="tool__head" type="button" @click="manual = !open">
      <span class="tool__icon">
        <span v-if="['writing', 'waiting', 'running'].includes(step.state)" class="spinner" />
        <svg v-else-if="step.state === 'done'" viewBox="0 0 16 16" width="13" height="13"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
        <svg v-else viewBox="0 0 16 16" width="13" height="13"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
      </span>
      <span class="tool__name">{{ step.name }}</span>
      <span class="tool__brief">{{ brief }}</span>
      <span class="tool__state">{{ labels[step.state] }}</span>
    </button>
    <div v-if="open" class="tool__content">
      <component :is="ToolViews[step.name]" v-if="ToolViews[step.name]" :step="step" />
      <template v-else>
        <pre class="tool__block">{{ args }}</pre>
        <pre v-if="step.log" class="tool__block tool__block--log">{{ step.log }}</pre>
        <pre v-if="result" class="tool__block" :class="{ 'tool__block--error': step.state === 'failed' }">{{ result }}</pre>
      </template>
    </div>
  </div>
</template>

<style scoped>
.tool__head { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 28px; padding: 0; border: 0; background: none; font: inherit; font-size: 13px; color: var(--muted); text-align: left; cursor: pointer; }
.tool__icon { display: inline-flex; width: 14px; justify-content: center; flex: none; color: var(--faint); }
.tool__name { flex: none; color: var(--text); font-weight: 500; }
.tool__brief { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--faint); font: 12px var(--mono); }
.tool__state { flex: none; color: var(--faint); font-size: 12px; }
.is-running .tool__state, .is-writing .tool__state, .is-waiting .tool__state { color: var(--muted); }
.is-failed .tool__icon, .is-failed .tool__state { color: var(--danger); }
.tool__content { display: flex; flex-direction: column; gap: 6px; margin: 4px 0 10px 22px; }
.tool__block { margin: 0; max-height: 240px; overflow: auto; padding: 10px 12px; border-radius: 12px; background: var(--soft); color: var(--muted); font: 12px/1.6 var(--mono); white-space: pre-wrap; word-break: break-word; }
.tool__block--log { color: var(--text); }
.tool__block--error { color: var(--danger); }
</style>
