<!--
一段“模型没说话”的过程：本次请求、思考、工具调用按发生顺序排成一列。
里面有东西正在流式或运行时整段展开；全部结束后收成一行图标概括（用时、思考几段、几个工具）；
有失败的工具就保持展开；用户手动点过以用户为准。只有一条请求时不折叠，直接显示那条 RequestStatus。
调用示例：<component :is="Components.Process" :steps="steps" :live="true" />
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { HugeiconsIcon as Icon } from '@hugeicons/vue'
import { ArrowRight01Icon, CancelCircleIcon, Clock01Icon, Idea01Icon, Wrench01Icon } from '@hugeicons/core-free-icons'
import { Components } from '../Extension'
import type { Step } from './History.vue'

const props = defineProps<{ steps: Step[]; live: boolean }>()
const manual = ref<boolean | null>(null)
const count = (kind: Step['kind'], state?: string) => props.steps.filter(step => step.kind === kind && (!state || (step.kind === 'tool' && step.state === state))).length
const failed = computed(() => count('tool', 'failed'))
const open = computed(() => manual.value ?? (props.live || failed.value > 0))
const single = computed(() => props.steps.length === 1 && props.steps[0]!.kind === 'request')

// 进行中：一句话说正在做什么（这是事实，不是猜测：取最后一个仍在进行的步骤）。
const doing = computed(() => {
  const step = props.steps.findLast(item => item.kind === 'request' ? item.live || item.retry : item.kind === 'thinking' ? item.live : ['writing', 'waiting', 'running'].includes(item.state))
  if (!step || step.kind === 'request') return step?.kind === 'request' && step.retry ? '等待重试' : '正在请求模型'
  if (step.kind === 'thinking') return '正在思考'
  return { writing: `正在写 ${step.name} 调用`, waiting: `准备运行 ${step.name}`, running: `正在运行 ${step.name}` }[step.state as 'writing']
})
// 结束后：这段过程里所有请求的耗时之和。
const time = computed(() => {
  const ms = props.steps.reduce((sum, step) => sum + (step.kind === 'request' ? step.request?.duration ?? 0 : 0), 0)
  return ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m${Math.round(ms % 60000 / 1000)}s`
})
</script>

<template>
  <div v-if="single" class="process">
    <component :is="Components.RequestStatus" :step="steps[0]" />
  </div>
  <div v-else class="process" :class="{ 'is-open': open }">
    <button class="process__head" type="button" :aria-expanded="open" @click="manual = !open">
      <span v-if="live" class="shimmer">{{ doing }}</span>
      <template v-else>
        <span class="process__fact" title="请求耗时"><Icon :icon="Clock01Icon" :size="15" />{{ time }}</span>
        <span v-if="count('thinking')" class="process__fact" title="思考段数"><Icon :icon="Idea01Icon" :size="15" />{{ count('thinking') }}</span>
        <span v-if="count('tool')" class="process__fact" title="工具调用"><Icon :icon="Wrench01Icon" :size="15" />{{ count('tool') }}</span>
        <span v-if="failed" class="process__fact is-failed" title="失败的工具"><Icon :icon="CancelCircleIcon" :size="15" />{{ failed }}</span>
      </template>
      <Icon class="process__chevron" :icon="ArrowRight01Icon" :size="15" />
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
.process__head { display: inline-flex; align-items: center; gap: 12px; height: 28px; margin-left: -8px; padding: 0 8px; border: 0; border-radius: 14px; background: none; color: var(--faint); font: inherit; font-size: 14px; font-variant-numeric: tabular-nums; cursor: pointer; }
.process__head:hover { background: var(--hover); color: var(--muted); }
.process__fact { display: inline-flex; align-items: center; gap: 4px; }
.process__fact.is-failed { color: var(--danger); }
.process__chevron { margin-left: -6px; transition: transform .2s ease; }
.is-open .process__chevron { transform: rotate(90deg); }
.process__fold { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .25s ease; }
.is-open .process__fold { grid-template-rows: 1fr; }
.process__body { overflow: hidden; display: flex; flex-direction: column; gap: 2px; margin-left: 7px; padding-left: 15px; border-left: 1px solid var(--line); }
.is-open .process__body { margin-top: 4px; }
</style>
