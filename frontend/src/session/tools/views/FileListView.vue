<!--
目录结果：显示目录路径和文件/子目录列表。
调用示例：<FileListView :tool="tool" />
-->
<script setup>
import { computed } from 'vue'
import { useToolContent } from '../use-tool-content.js'

const props = defineProps({ tool: { type: Object, required: true } })
const { input, value, text } = useToolContent(props)
const entries = computed(() => {
  if (Array.isArray(value.value)) return value.value.map(item => String(item))
  return text.value.split(/\r?\n/).map(item => item.trim()).filter(Boolean)
})
</script>

<template>
  <div class="tool-meta">
    <span>{{ input.path }}</span>
    <span v-if="input.recursive">递归</span>
  </div>
  <div v-if="entries.length" class="file-list">
    <span v-for="entry in entries" :key="entry" class="file-entry">{{ entry }}</span>
  </div>
  <p v-else class="tool-empty">目录为空</p>
</template>
