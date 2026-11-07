<!--
工具步骤：结果框默认收起，运行中不再跟着状态打开再关上。
要执行的内容最多三行，批准按钮固定在这一行下面，收起处理过程时也还在。
出错或被拒绝时展开结果；任务清单保持展开。点标题才打开完整结果。
调用示例：<ToolCall :tool="tool" :session-id="session.id" />
-->
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Icon from '../../ui/Icon.vue'
import Button from '../../ui/Button.vue'
import { Chat } from '../../commands/chat.js'
import ToolResult from './ToolResult.vue'
import { fillTemplate, toolIcon, toolTitle, uiFor } from "../../utils/tool.js"

defineOptions({ name: 'ToolCall' })

const props = defineProps({
  tool: { type: Object, required: true },
  sessionId: { type: String, required: true },
})
const now = ref(Date.now())
// null 表示还没手动点过：出错、被拒绝和任务清单自动展开。运行中、等待批准都保持收起。
const preference = ref(props.tool.name === 'update_todo_list' ? true : null)
const bodyId = `tool-body-${props.tool.id || props.tool.name}`
let timer = null

const title = computed(() => toolTitle(props.tool))
// 没有声明摘要时，把参数值拼出来，收起时也能看到即将执行的内容。
function inputPreview(input) {
  if (input == null || input === '') return ''
  if (typeof input !== 'object') return String(input)
  return Object.values(input).flatMap(value => {
    if (value == null || value === '') return []
    return [typeof value === 'string' ? value : JSON.stringify(value)]
  }).join(' ')
}
const summary = computed(() => {
  if (props.tool.assembling && props.tool.streamInput) return String(props.tool.streamInput).trim()
  return fillTemplate(uiFor(props.tool.name).summary, props.tool.input) || inputPreview(props.tool.input)
})
const statusLabel = status => ({ waiting: '等待你的许可', running: '正在执行', completed: '已完成', error: '执行失败', rejected: '已拒绝' }[status] || '等待结果')
const statusText = computed(() => {
  if (props.tool.assembling) return '正在生成参数'
  // 任务清单的工具完成只代表“清单已更新”，不是清单里的任务都完成了。
  if (props.tool.name === 'update_todo_list' && props.tool.status === 'completed') return '已更新'
  return statusLabel(props.tool.status)
})
const statusClass = status => `is-${status || 'waiting'}`
const running = computed(() => props.tool.status === 'running' || props.tool.status === 'waiting')
const duration = computed(() => {
  const recorded = Number(props.tool.durationMs || 0)
  let milliseconds = recorded
  if (!milliseconds) {
    const startedAt = Number(props.tool.startedAt || 0)
    if (!startedAt) return ''
    const end = Number(props.tool.finishedAt || 0) || (running.value ? now.value : 0)
    if (!end) return ''
    milliseconds = end - startedAt
  }
  const seconds = Math.round(milliseconds / 1000)
  return seconds > 0 ? `${seconds}s` : ''
})
// 高速执行时不跟着状态把结果框打开再关上。出错或被拒绝才自动展开；其余只听用户的点击。
const bodyOpen = computed(() => preference.value ?? (props.tool.status === 'error' || props.tool.status === 'rejected'))

function toggleBody() {
  preference.value = !bodyOpen.value
}

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
    <span class="cot-step__icon"><Icon :name="toolIcon(tool)" :size="16" /></span>
    <div class="cot-step__main">
      <button
        type="button"
        class="cot-step__head"
        :aria-expanded="bodyOpen"
        :aria-controls="bodyOpen ? bodyId : undefined"
        @click="toggleBody"
      >
        <span class="cot-step__label" :class="{ 'is-live': running }">{{ title }}</span>
        <span class="cot-step__extra" :class="statusClass(tool.status)"><span>{{ statusText }}</span><template v-if="duration"> · {{ duration }}</template></span>
        <Icon name="down" :size="14" class="cot-step__caret" :class="{ 'is-open': bodyOpen }" aria-hidden="true" />
      </button>
      <p v-if="summary" class="cot-step__summary cot-step__summary--preview" :title="summary">{{ summary }}</p>
      <div v-if="tool.status === 'waiting'" class="approval" @click.stop>
        <p>需要你的许可。检查工具和参数后再决定。</p>
        <div>
          <Button variant="danger" :disabled="tool.deciding" @click="decide('deny')">拒绝</Button>
          <Button :disabled="tool.deciding" @click="decide('always-allow')">始终允许此参数</Button>
          <Button variant="primary" :disabled="tool.deciding" @click="decide('allow-once')">允许一次</Button>
        </div>
      </div>
      <div v-if="bodyOpen" :id="bodyId" class="cot-step__body">
        <ToolResult :tool="tool" />
      </div>
      <div v-if="tool.subagentSteps?.length" class="subagent-branch">
        <div class="subagent-branch__head">
          <Icon name="branch" :size="14" />
          <span>{{ tool.subagentDescription || '子智能体处理过程' }}</span>
          <em>{{ tool.subagentSteps.length }} 个步骤</em>
        </div>
        <div class="subagent-branch__steps">
          <ToolCall
            v-for="child in tool.subagentSteps"
            :key="child.id"
            :tool="child"
            :session-id="sessionId"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" src="../../styles/components/activity/ToolCall.scss"></style>
