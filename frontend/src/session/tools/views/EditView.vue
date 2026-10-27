<!--
编辑结果：左右对照显示替换前和替换后的文本。
调用示例：<EditView :tool="tool" />
-->
<script setup>
import { clip, useToolContent } from '../use-tool-content.js'

const props = defineProps({ tool: { type: Object, required: true } })
const { input, text } = useToolContent(props)
</script>

<template>
  <div class="edit-pair">
    <div>
      <small>替换前</small>
      <pre class="tool-output">{{ clip(input.old_string || input.oldText) }}</pre>
    </div>
    <div>
      <small>替换后</small>
      <pre class="tool-output">{{ clip(input.new_string || input.newText) }}</pre>
    </div>
  </div>
  <div v-if="text" class="tool-result">{{ text }}</div>
</template>
