<!--
一次工具调用：模型一开始写调用就出现并展开，参数边写边长；放行后运行，实时输出在框里往下滚；
结束后收成一行（状态图标、名字、参数摘要），点开再看参数、输出和结果。失败自动展开；用户手动操作优先。
内容区可被扩展按工具名替换：ToolViews[toolName] 收到同一个 step。
调用示例：<component :is="Components.ToolCall" :step="step" />
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from './Icon.vue'
import { ArrowRight01Icon, BlockedIcon, CancelCircleIcon, Clock01Icon, MinusSignCircleIcon, PencilEdit01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { ToolViews } from '../Extension'
import type { Step } from './History.vue'

const props = defineProps<{ step: Extract<Step, { kind: 'tool' }> }>()
const manual = ref<boolean | null>(null)
const live = computed(() => ['writing', 'waiting', 'running'].includes(props.step.state))
const open = computed(() => manual.value ?? (live.value || props.step.state === 'failed'))
const icons = { writing: PencilEdit01Icon, waiting: Clock01Icon, done: Tick02Icon, failed: CancelCircleIcon, denied: BlockedIcon, cancelled: MinusSignCircleIcon }
const meanings = { writing: '模型正在写调用参数', waiting: '调用已写完，等待运行', running: '运行中', done: '完成', failed: '失败', denied: '已拒绝', cancelled: '已取消' }

// 收起时的一行摘要：第一个字符串参数（展开时下面就是完整参数，不重复）。
const brief = computed(() => {
  const input = props.step.input
  return input && typeof input === 'object' ? String(Object.values(input).find(value => typeof value === 'string') ?? JSON.stringify(input)) : props.step.raw
})
const args = computed(() => props.step.input === undefined ? props.step.raw ?? '' : JSON.stringify(props.step.input, null, 2))
const result = computed(() => {
  const output = props.step.output
  if (!output) return ''
  if (output.type === 'execution-denied') return output.reason ?? '已拒绝'
  return typeof output.value === 'string' ? output.value : JSON.stringify(output.value, null, 2)
})
// 实时输出框跟着滚到底。
const vBottom = { updated: (element: HTMLElement) => { element.scrollTop = element.scrollHeight } }
</script>

<template>
  <div class="tool" :class="[`is-${step.state}`, { 'is-open': open }]">
    <button class="tool__head" type="button" :aria-expanded="open" :title="meanings[step.state]" @click="manual = !open">
      <span v-if="step.state === 'running'" class="spinner" />
      <Icon v-else :icon="icons[step.state as 'done']" :size="16" />
      <span class="tool__name">{{ step.name }}</span>
      <span v-if="!open" class="tool__brief">{{ brief }}</span>
      <Icon class="tool__chevron" :icon="ArrowRight01Icon" :size="14" />
    </button>
    <div v-if="open" class="tool__content">
      <component :is="ToolViews[step.name]" v-if="ToolViews[step.name]" :step="step" />
      <template v-else>
        <pre class="tool__block" :class="{ 'is-writing': step.state === 'writing' }">{{ args }}</pre>
        <pre v-if="step.log || result" v-bottom class="tool__block tool__block--log" :class="{ 'is-error': step.state === 'failed' }">{{ step.log || result }}</pre>
      </template>
    </div>
  </div>
</template>

<style scoped>
.tool__head { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 32px; padding: 0; border: 0; background: none; font: inherit; font-size: 13.5px; color: var(--faint); text-align: left; cursor: pointer; }
.tool__head > svg { flex: none; }
.tool__head:hover { color: var(--muted); }
.tool__name { flex: none; color: var(--text); font-weight: 500; }
.tool__brief { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 12.5px var(--mono); }
.tool__chevron { flex: none; margin-left: auto; opacity: .6; transition: transform .2s ease, opacity .15s; }
.tool__head:hover .tool__chevron, .is-open .tool__chevron { opacity: 1; }
.is-open .tool__chevron { transform: rotate(90deg); }
.is-done .tool__head > svg:first-child { color: var(--success); }
.is-failed .tool__head > svg:first-child { color: var(--danger); }
.is-writing .tool__head > svg:first-child { color: var(--text); animation: pulse 1s ease-in-out infinite; }
.tool__content { display: flex; flex-direction: column; gap: 6px; margin: 2px 0 10px 26px; }
.tool__block { margin: 0; max-height: 200px; overflow: auto; padding: 10px 12px; border-radius: 12px; background: var(--soft); color: var(--muted); font: 12.5px/1.65 var(--mono); white-space: pre-wrap; word-break: break-word; }
.tool__block.is-writing::after { content: '▍'; animation: pulse 1s ease-in-out infinite; }
.tool__block--log { color: var(--text); }
.tool__block--log.is-error { color: var(--danger); }
@keyframes pulse { 50% { opacity: .3; } }
</style>
