<script setup>
import { useToolContent } from '../use-tool-content.js'

const props = defineProps({ tool: { type: Object, required: true } })
const { input, text } = useToolContent(props)
</script>

<template>
  <div class="tool-meta">
    <span>正则 <code>{{ input.regex || input.pattern }}</code></span>
    <span v-if="input.file_pattern || input.include">{{ input.file_pattern || input.include }}</span>
  </div>
  <pre v-if="text" class="tool-output">{{ text }}</pre>
  <p v-else class="tool-empty">没有匹配结果</p>
</template>
