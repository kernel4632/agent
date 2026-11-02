<!-- 圆环进度：SVG 不依赖图表库。示例：<RingProgress :value="30" :size="42" label="上下文占用" /> -->
<script setup>
import { computed } from 'vue'
const props = defineProps({ value: Number, max: { type: Number, default: 100 }, size: { type: Number, default: 48 }, strokeWidth: { type: Number, default: 4 }, label: String })
const percent = computed(() => Math.min(100, Math.max(0, props.value / (props.max || 1) * 100)))
</script>
<template><svg class="ui-ring-progress" :width="size" :height="size" viewBox="0 0 100 100" role="progressbar" :aria-label="label" aria-valuemin="0" :aria-valuemax="max" :aria-valuenow="value"><circle class="ui-ring-progress__track" cx="50" cy="50" r="44" :stroke-width="strokeWidth * 100 / size" /><circle class="ui-ring-progress__value" cx="50" cy="50" r="44" pathLength="100" :stroke-width="strokeWidth * 100 / size" :stroke-dasharray="`${percent} 100`" /></svg></template>
<style scoped lang="scss" src="../styles/ui/RingProgress.scss"></style>
