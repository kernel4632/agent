<!--
工具步骤：嵌在思考卡片里的时间线节点。
流式时标题扫光并显示状态；点击展开参数、结果和审批按钮。
调用示例：<ToolCallRow :tool="tool" :session-id="session.id" />
-->
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { AppIcon, Button } from '../ui/index.js'
import { Chat } from '../commands/chat.js'
import ToolView from './tools/ToolView.vue'
import { canonicalToolName, toolIcon, toolLabel } from './tool-ui.js'

const props = defineProps({
  tool: { type: Object, required: true },
  sessionId: { type: String, required: true },
})
// 任务清单带可读的渲染结果，默认展开；其他工具等用户点开。
const open = ref(props.tool.status === 'waiting' || canonicalToolName(props.tool.name) === 'update_todo_list')
const now = ref(Date.now())
let timer = null

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

watch(running, value => {
  if (timer) { window.clearInterval(timer); timer = null }
  if (value) timer = window.setInterval(() => { now.value = Date.now() }, 200)
}, { immediate: true })

watch(() => props.tool.status, status => {
  if (status === 'waiting') open.value = true
})

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
})

function decide(decision) {
  Chat.decide(props.sessionId, props.tool.id, decision)
}
</script>

<template>
  <div class="cot-step cot-step--tool" :class="{ 'is-live': running }">
    <span class="cot-step__icon"><AppIcon :name="toolIcon(tool)" :size="16" /></span>
    <div class="cot-step__main">
      <button type="button" class="cot-step__head" :aria-expanded="open" @click="open = !open">
        <span class="cot-step__label" :class="{ 'is-live': running }" :title="toolLabel(tool)">{{ toolLabel(tool) }}</span>
        <span class="cot-step__extra" :class="statusClass(tool.status)"><span>{{ statusText }}</span><template v-if="duration"> · {{ duration }}</template></span>
        <AppIcon name="down" :size="16" class="cot-step__caret" :class="{ 'is-open': open }" aria-hidden="true" />
      </button>
      <div class="cot-collapse" :class="{ 'is-open': open }" :inert="!open" :aria-hidden="!open">
        <div class="cot-collapse__inner">
          <div class="cot-step__body">
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
    </div>
  </div>
</template>
