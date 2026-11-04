<!--
  通用工具结果：所有工具共用参数与返回内容区域，不登记按工具类型划分的前端视图。
  默认展示返回内容；输入参数折叠在下方，需要时再展开。
  参数和对象结果走 ToolValue：多行字符串保留换行，带 fenced code 的内容按 Markdown 渲染。
  调用示例：<ToolResult :tool="tool" />。
-->
<script setup>
import Icon from '../../ui/Icon.vue'
import { computed, ref } from 'vue'
import { outputValue } from '../../commands/tool.js'
import ToolValue from './ToolValue.vue'

const props = defineProps({ tool: { type: Object, required: true } })
const view = ref('readable') // readable | raw
const showInput = ref(false)

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
const emptyText = computed(() => props.tool.status === 'completed'
  ? '工具没有返回内容'
  : props.tool.status === 'rejected'
    ? '本次调用已被拒绝'
    : props.tool.status === 'error'
      ? '工具执行失败，未返回错误详情'
      : '等待工具结果…')
</script>

<template>
  <div class="tool-view">
    <section v-if="streaming" class="tool-content tool-content--stream" aria-label="正在生成参数">
      <h4>参数正在生成</h4>
      <pre v-auto-scroll class="tool-output tool-input is-streaming">{{ tool.streamInput }}</pre>
    </section>

    <section class="tool-content tool-content--output" aria-label="返回内容">
      <h4>返回内容</h4>
      <ToolValue v-if="hasResult" :value="resultValue" class="tool-result" :class="{ 'is-error': tool.status === 'error' || tool.status === 'rejected' }" :plain="typeof resultValue === 'string'" />
      <p v-else class="tool-empty">{{ emptyText }}</p>
    </section>

    <section v-if="hasInput && !streaming" class="tool-content tool-content--input" :class="{ 'is-collapsed': !showInput }" aria-label="输入参数">
      <div class="tool-content__head">
        <button v-if="!showInput" type="button" class="tool-input-toggle" :aria-expanded="false" @click="showInput = true">
          <Icon name="code" :size="13" />查看输入参数<Icon name="down" :size="13" class="tool-input-toggle__caret" />
        </button>
        <template v-else>
          <h4>输入参数</h4>
          <div class="tool-input-actions">
            <div class="tool-view-switch" role="group" aria-label="参数显示方式">
              <button type="button" :class="{ 'is-active': view === 'readable' }" :aria-pressed="view === 'readable'" @click="view = 'readable'">渲染</button>
              <button type="button" :class="{ 'is-active': view === 'raw' }" :aria-pressed="view === 'raw'" @click="view = 'raw'">原始</button>
            </div>
            <button type="button" class="tool-input-collapse" @click="showInput = false">收起</button>
          </div>
        </template>
      </div>
      <template v-if="showInput">
        <ToolValue v-if="view === 'readable'" :value="tool.input" class="tool-input" />
        <pre v-else class="tool-output tool-input">{{ inputJSON }}</pre>
      </template>
    </section>
  </div>
</template>

<style scoped lang="scss" src="../../styles/components/activity/ToolResult.scss"></style>
