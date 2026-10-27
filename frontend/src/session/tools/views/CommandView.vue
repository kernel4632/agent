<!--
命令结果：显示执行的命令、stdout/stderr 和退出码。
调用示例：<CommandView :tool="tool" />
-->
<script setup>
import { computed } from 'vue'
import { useToolContent } from '../use-tool-content.js'

const props = defineProps({ tool: { type: Object, required: true } })
const { input, value, text } = useToolContent(props)
const command = computed(() => value.value && typeof value.value === 'object' && !Array.isArray(value.value) ? value.value : null)
</script>

<template>
  <div v-if="input.command" class="tool-kicker"><code>{{ input.command }}</code></div>
  <template v-if="command">
    <pre v-if="command.stdout" class="tool-output">{{ command.stdout }}</pre>
    <pre v-if="command.stderr" class="tool-output is-error">{{ command.stderr }}</pre>
    <div class="tool-meta">
      <span>退出码 {{ command.exitCode ?? '-' }}</span>
      <span v-if="command.timedOut" class="is-error">已超时</span>
    </div>
  </template>
  <pre v-else-if="text" class="tool-output">{{ text }}</pre>
</template>
