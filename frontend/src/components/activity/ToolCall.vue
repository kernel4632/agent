<!--
工具步骤：结果框默认收起，运行中不再跟着状态打开再关上。
要执行的内容最多三行，批准按钮跟在这一行下面。需要批准时由外层把处理过程展开。
出错或被拒绝时展开结果；任务清单保持展开。点标题才打开完整结果。
调用示例：<ToolCall :tool="tool" :session-id="session.id" />
-->
<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Icon from '../../ui/Icon.vue'
import Button from '../../ui/Button.vue'
import Fold from '../../ui/Fold.vue'
import { Approval } from '../../features/approval.js'
import ToolResult from './ToolResult.vue'
import { fillTemplate, toolIcon, toolTitle, uiFor } from "../../utils/tool.js"

defineOptions({ name: 'ToolCall' })

const props = defineProps({
  tool: { type: Object, required: true },
  sessionId: { type: String, required: true },
  instant: Boolean,
  streamKey: { type: Number, default: 0 },
  active: Boolean,
  toolIndex: { type: Number, default: 0 },
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
// 参数流式生成和工具执行中自动展开，让读者能实时看到正在写入/执行的内容；
// 这一轮结束后恢复折叠，之后由用户自己决定要不要再看结果。
const wantsAuto = computed(() => Boolean(props.active && (props.tool.assembling || props.tool.status === 'running')))
// 新工具要等上一个工具的高度收起，避免两个 Fold 同时运动；第一个工具直接展开。
// 并行工具由外层同时传入 active，各自按自己的完成状态收起。
const SETTLE_MS = 650
const openReady = ref(false)
let openTimer = null
// 工具完成先保留展开结果；等下一次模型请求真正开始、流里出现新内容时，
// 再从当前高度慢速收起。工具刚开始时 Fold 也从 0 高度缓慢展开。
const lingerOpen = ref(false)
// 收起动画期间继续保留最后一段参数流；否则内容先被 v-if 移除，Fold 才量高度。
const closing = ref(false)
let closingTimer = null
const holdStream = computed(() => Boolean((props.tool.assembling || lingerOpen.value || closing.value) && props.tool.streamInput))
const autoOpen = computed(() => wantsAuto.value && openReady.value)
const bodyOpen = computed(() => autoOpen.value || lingerOpen.value || (preference.value ?? (props.tool.status === 'error' || props.tool.status === 'rejected')))
watch(bodyOpen, (open, previous) => {
  if (open) {
    closing.value = false
    if (closingTimer) {
      window.clearTimeout(closingTimer)
      closingTimer = null
    }
    return
  }
  if (!previous) return
  closing.value = true
  if (closingTimer) window.clearTimeout(closingTimer)
  closingTimer = window.setTimeout(() => {
    closing.value = false
    closingTimer = null
  }, 700)
})
function clearOpenTimer() {
  if (openTimer) {
    window.clearTimeout(openTimer)
    openTimer = null
  }
}
watch([() => props.active, () => props.tool.assembling, () => props.tool.status], () => {
  clearOpenTimer()
  if (!wantsAuto.value) {
    openReady.value = false
    return
  }
  if (openReady.value) return
  if (!props.active || props.toolIndex === 0) {
    openReady.value = true
    return
  }
  openTimer = window.setTimeout(() => {
    openReady.value = true
    openTimer = null
  }, SETTLE_MS)
}, { immediate: true })
watch(wantsAuto, (open, previous) => {
  if (open) {
    lingerOpen.value = false
    return
  }
  if (!previous) return
  if (props.instant) {
    lingerOpen.value = false
    return
  }
  // 工具执行完不立刻收：先保留结果，等下一段流式内容真正到达（streamKey 变化）
  // 再折叠。并行时另一个工具开始，也不会把已完成的这个提前收掉。
  lingerOpen.value = true
})
watch(() => props.instant, instant => {
  if (instant) lingerOpen.value = false
})
// 下一次请求的第一段文字/思考到达时，这个值才增加；
// 不能在 llm-start 时关闭，那时还没有真正流出内容。
watch(() => props.streamKey, (key, previous) => {
  if (key === previous || !lingerOpen.value) return
  lingerOpen.value = false
})

function toggleBody() {
  lingerOpen.value = false
  preference.value = !bodyOpen.value
}

watch(running, value => {
  if (timer) { window.clearInterval(timer); timer = null }
  if (value) timer = window.setInterval(() => { now.value = Date.now() }, 200)
}, { immediate: true })

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer)
  clearOpenTimer()
  if (closingTimer) window.clearTimeout(closingTimer)
})

function decide(decision) {
  Approval.decide(props.sessionId, props.tool.id, decision)
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
        <span v-if="summary" class="cot-step__summary cot-step__summary--preview" :title="summary">{{ summary }}</span>
        <span class="cot-step__extra" :class="statusClass(tool.status)"><span>{{ statusText }}</span><template v-if="duration"> · {{ duration }}</template></span>
        <Icon name="down" :size="14" class="cot-step__caret" :class="{ 'is-open': bodyOpen }" aria-hidden="true" />
      </button>
      <div v-if="tool.status === 'waiting'" class="approval" @click.stop>
        <p>需要你的许可。检查工具和参数后再决定。</p>
        <div>
          <Button variant="danger" :disabled="tool.deciding" @click="decide('deny')">拒绝</Button>
          <Button variant="primary" :disabled="tool.deciding" @click="decide('allow')">允许</Button>
        </div>
      </div>
      <Fold :open="bodyOpen" :instant="instant" slow appear :fade="false">
        <div :id="bodyId" class="cot-step__body">
          <ToolResult :tool="tool" :holding="holdStream" />
        </div>
      </Fold>
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
