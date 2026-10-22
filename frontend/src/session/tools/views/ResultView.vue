<script setup>
import { computed } from 'vue'
import { uiFor } from '../../tool-ui.js'
import { useToolContent } from '../use-tool-content.js'

const props = defineProps({ tool: { type: Object, required: true } })
const { input, text } = useToolContent(props)
const question = computed(() => uiFor(props.tool.name).view === 'question')
const content = computed(() => text.value || input.value.question || input.value.result || '')
</script>

<template>
  <div class="tool-result" :class="{ 'is-question': question }">{{ content }}</div>
</template>
