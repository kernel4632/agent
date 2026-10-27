<!--
文件读取结果：显示 read_file / write_to_file 的正文或错误。
调用示例：<FileView :tool="tool" />
-->
<script setup>
import { useToolContent } from '../use-tool-content.js'

const props = defineProps({ tool: { type: Object, required: true } })
const { text } = useToolContent(props)
</script>

<template>
  <pre v-if="text" class="tool-output" :class="{ 'is-error': tool.status === 'error' || tool.status === 'rejected' }">{{ text }}</pre>
  <p v-else class="tool-empty">暂无输出</p>
</template>
