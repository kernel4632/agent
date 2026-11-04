<!--
  通用工具结果：所有工具共用参数与返回内容区域，不登记按工具类型划分的前端视图。
  参数和对象结果走 ToolValue：多行字符串保留换行，带 fenced code 的内容按 Markdown 渲染。
  标题、状态和审批仍由 ToolCall 负责。调用示例：<ToolResult :tool="tool" />。
-->
<script setup>
import { Notice } from '../../commands/notice.js'
import { copyText } from '../../utils/clipboard.js'
import Icon from '../../ui/Icon.vue'
import Button from '../../ui/Button.vue'
import { computed, ref } from 'vue'
import { outputValue, actionTarget, toolActions } from '../../commands/tool.js'
import ToolValue from './ToolValue.vue'

const props = defineProps({ tool: { type: Object, required: true } })
const view = ref('readable') // readable | raw

// 参数流一直在追加，滚动到底部才能看到模型当前拼到哪。
const vAutoScroll = {
  mounted: element => { element.scrollTop = element.scrollHeight },
  updated: element => { element.scrollTop = element.scrollHeight },
}

const hasInput = computed(() => props.tool.input != null
  && (typeof props.tool.input !== 'object' || Object.keys(props.tool.input).length > 0))
const inputJSON = computed(() => hasInput.value ? JSON.stringify(props.tool.input, null, 2) : '')
const streaming = computed(() => props.tool.assembling && props.tool.streamInput) // 模型还在拼参数，先显示原始增量
const resultValue = computed(() => {
  const output = props.tool.output
  if (output == null) return props.tool.preview || ''
  if (output.type === 'execution-denied') return output.reason || ''
  return outputValue(props.tool)
})
const hasResult = computed(() => {
  const value = resultValue.value
  if (value == null || value === '') return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
})
const actions = computed(() => toolActions(props.tool)) // 保留工具声明的复制、打开动作

async function run(action) {
  const value = actionTarget(props.tool, action)
  if (!value) return
  if (action.type === 'copy') await copyMessage(value)
  if (action.type === 'open') window.open(value, '_blank', 'noopener,noreferrer')
}

// 复制只在本区域反馈，剪贴板工具不依赖页面。
async function copyMessage(text) { Notice.show(await copyText(text) ? '已复制' : '复制失败'); }

</script>

<template>
  <div class="tool-view">
    <section v-if="streaming" class="tool-content" aria-label="正在生成参数">
      <h4>参数正在生成</h4>
      <pre v-auto-scroll class="tool-output tool-input is-streaming">{{ tool.streamInput }}</pre>
    </section>
    <section v-else-if="hasInput" class="tool-content" aria-label="输入参数">
      <div class="tool-content__head">
        <h4>输入参数</h4>
        <div class="tool-view-switch" role="group" aria-label="参数显示方式">
          <button type="button" :class="{ 'is-active': view === 'readable' }" :aria-pressed="view === 'readable'" @click="view = 'readable'">渲染</button>
          <button type="button" :class="{ 'is-active': view === 'raw' }" :aria-pressed="view === 'raw'" @click="view = 'raw'">原始</button>
        </div>
      </div>
      <ToolValue v-if="view === 'readable'" :value="tool.input" class="tool-input" />
      <pre v-else class="tool-output tool-input">{{ inputJSON }}</pre>
    </section>
    <section v-if="hasResult" class="tool-content" aria-label="返回内容">
      <h4>返回内容</h4>
      <ToolValue :value="resultValue" class="tool-result" :class="{ 'is-error': tool.status === 'error' || tool.status === 'rejected' }" :plain="typeof resultValue === 'string'" />
    </section>
    <p v-else class="tool-empty">{{ tool.status === 'completed' ? '工具没有返回内容' : tool.status === 'rejected' ? '本次调用已被拒绝' : tool.status === 'error' ? '工具执行失败，未返回错误详情' : '等待工具结果…' }}</p>
    <div v-if="actions.length" class="tool-actions">
      <Button v-for="action in actions" :key="action.id" variant="ghost" size="small" @click="run(action)">
        <Icon v-if="action.icon" :name="action.icon" :size="13" />{{ action.label }}
      </Button>
    </div>
  </div>
</template>

<style scoped lang="scss" src="../../styles/components/activity/ToolResult.scss"></style>
