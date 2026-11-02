<!--
文件读取结果：显示 read_file / write_to_file 的正文或错误。
调用示例：<FileView :tool="tool" />
-->
<script>
// 服务端声明的输出类型；注册归本视图所有。
export const kinds = ["file-read","file-write"]
</script>
<script setup>
import { useToolContent } from './content.js'

const props = defineProps({ tool: { type: Object, required: true } })
const { text } = useToolContent(props)
</script>

<template>
  <pre v-if="text" class="tool-output" :class="{ 'is-error': tool.status === 'error' || tool.status === 'rejected' }">{{ text }}</pre>
  <p v-else class="tool-empty">暂无输出</p>
</template>

<style scoped lang="scss" src="../../styles/components/results/FileView.scss"></style>
