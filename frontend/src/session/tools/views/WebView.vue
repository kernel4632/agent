<!--
网页读取结果：显示来源链接和正文。
调用示例：<WebView :tool="tool" />
-->
<script setup>
import { useToolContent } from '../use-tool-content.js'

const props = defineProps({ tool: { type: Object, required: true } })
const { input, text } = useToolContent(props)
</script>

<template>
  <a v-if="input.url" :href="input.url" target="_blank" rel="noreferrer" class="tool-link">{{ input.url }}</a>
  <pre v-if="text" class="tool-output">{{ text }}</pre>
</template>
