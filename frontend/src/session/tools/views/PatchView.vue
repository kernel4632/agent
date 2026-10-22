<script setup>
import { computed } from 'vue'
import { useToolContent } from '../use-tool-content.js'

const props = defineProps({ tool: { type: Object, required: true } })
const { input, text } = useToolContent(props)
const paths = computed(() => (Array.isArray(input.value.patches) ? input.value.patches : [])
  .map(patch => patch?.path || patch?.file_path)
  .filter(Boolean))
</script>

<template>
  <div v-if="paths.length" class="file-list">
    <span v-for="path in paths" :key="path" class="file-entry">{{ path }}</span>
  </div>
  <div v-if="text" class="tool-result">{{ text }}</div>
</template>
