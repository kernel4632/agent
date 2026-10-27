<!--
通用工具结果：没有专用视图时显示输入 JSON 和输出文本。
调用示例：<GenericView :tool="tool" />
-->
<script setup>
import { computed } from 'vue'
import { useToolContent } from '../use-tool-content.js'

const props = defineProps({ tool: { type: Object, required: true } })
const { input, text } = useToolContent(props)
const hasInput = computed(() => Object.keys(input.value).length > 0)
</script>

<template>
  <pre v-if="hasInput" class="tool-output">{{ JSON.stringify(input, null, 2) }}</pre>
  <pre v-if="text" class="tool-output" :class="{ 'is-error': tool.status === 'error' || tool.status === 'rejected' }">{{ text }}</pre>
</template>
