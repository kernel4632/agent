<!--
工具步骤：嵌在思考卡片里的时间线节点，默认全部展开。
流式时标题扫光并显示状态；参数、结果和审批始终可见，不再折叠。
调用示例：<ToolCallRow :tool="tool" :session-id="session.id" />
-->
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { AppIcon, Button } from '../ui/index.js'
import { Chat } from './chat.js'
import ToolView from './tools/ToolView.vue'
import { canonicalToolName, fillTemplate, toolIcon, toolTitle, uiFor } from './tool-ui.js'

const props = defineProps({
  tool: { type: Object, required: true },
  sessionId: { type: String, required: true },
})
const now = ref(Date.now())
const expanded = ref(canonicalToolName(props.tool.name) === 'update_todo_list')
const bodyId = `tool-body-${props.tool.id || props.tool.name}`
let timer = null

const title = computed(() => toolTitle(props.tool))
const summary = computed(() => fillTemplate(uiFor(props.tool.name).summary, props.tool.input))
const statusLabel = status => ({ waiting: '等待你的许可', running: '正在执行', completed: '已完成', error: '执行失败', rejected: '已拒绝' }[status] || '等待结果')
const statusText = computed(() => {
  // 任务清单的工具完成只代表“清单已更新”，不是清单里的任务都完成了。
  if (canonicalToolName(props.tool.name) === 'update_todo_list' && props.tool.status === 'completed') return '已更新'
  return statusLabel(props.tool.status)
})
const statusClass = status => `is-${status || 'waiting'}`
const running = computed(() => props.tool.status === 'running' || props.tool.status === 'waiting')
const duration = computed(() => {
  if (!props.tool.startedAt) return ''
  const end = props.tool.finishedAt || (running.value ? now.value : 0)
  if (!end) return ''
  const seconds = (end - props.tool.startedAt) / 1000
  return seconds >= 0.1 ? `${seconds.toFixed(1)}s` : ''
})
// 运行中和等待审批时必须看得到输出/按钮；历史里完成的工具默认收起，点标题再展开。
const bodyOpen = computed(() => expanded.value || running.value || props.tool.status === 'error')

watch(() => props.tool.status, (status, previous) => {
  if (previous === 'running' || previous === 'waiting') expanded.value = true
  if (status === 'running' || status === 'waiting') expanded.value = true
})
watch(running, value => {
  if (timer) { window.clearInterval(timer); timer = null }
  if (value) timer = window.setInterval(() => { now.value = Date.now() }, 200)
}, { immediate: true })

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
})

function decide(decision) {
  Chat.decide(props.sessionId, props.tool.id, decision)
}
</script>

<template>
  <div class="cot-step cot-step--tool" :class="{ 'is-live': running, 'is-open': bodyOpen }">
    <span class="cot-step__icon"><AppIcon :name="toolIcon(tool)" :size="16" /></span>
    <div class="cot-step__main">
      <button
        type="button"
        class="cot-step__head"
        :aria-expanded="bodyOpen"
        :aria-controls="bodyId"
        @click="expanded = !expanded"
      >
        <span class="cot-step__label" :class="{ 'is-live': running }">{{ title }}</span>
        <span v-if="summary" class="cot-step__summary" :title="summary">{{ summary }}</span>
        <span class="cot-step__extra" :class="statusClass(tool.status)"><span>{{ statusText }}</span><template v-if="duration"> · {{ duration }}</template></span>
        <AppIcon name="down" :size="14" class="cot-step__caret" :class="{ 'is-open': bodyOpen }" aria-hidden="true" />
      </button>
      <div v-if="bodyOpen" :id="bodyId" class="cot-step__body">
        <ToolView :tool="tool" />
        <div v-if="tool.status === 'waiting'" class="approval" @click.stop>
          <p>需要你的许可。检查工具和参数后再决定。</p>
          <div>
            <Button variant="danger" :disabled="tool.deciding" @click="decide('deny')">拒绝</Button>
            <Button :disabled="tool.deciding" @click="decide('always-allow')">始终允许此参数</Button>
            <Button variant="primary" :disabled="tool.deciding" @click="decide('allow-once')">允许一次</Button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
