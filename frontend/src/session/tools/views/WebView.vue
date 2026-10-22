<script setup>
import { useToolContent } from '../use-tool-content.js'

const props = defineProps({ tool: { type: Object, required: true } })
const { input, text } = useToolContent(props)
</script>

<template>
  <a v-if="input.url" :href="input.url" target="_blank" rel="noreferrer" class="tool-link">{{ input.url }}</a>
  <pre v-if="text" class="tool-output">{{ text }}</pre>
</template>
