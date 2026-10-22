<script setup>
import { useToolContent } from '../use-tool-content.js'

const props = defineProps({ tool: { type: Object, required: true } })
const { input } = useToolContent(props)
</script>

<template>
  <div v-if="input.description" class="tool-kicker">{{ input.description }}</div>
  <pre v-if="input.prompt" class="tool-output">{{ input.prompt }}</pre>
</template>
