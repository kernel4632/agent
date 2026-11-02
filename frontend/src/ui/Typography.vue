<!-- 文本：有限的标题、正文、说明层级。示例：<Typography type="heading" :level="3">标题</Typography> -->
<script setup>
import { computed } from 'vue'
const props = defineProps({ type: { type: String, default: 'body' }, level: { type: Number, default: 2 }, size: String })
const tag = computed(() => props.type === 'heading' ? `h${Math.max(1, Math.min(6, props.level))}` : 'p')
</script>
<template><component :is="tag" class="ui-typography" :class="[`ui-typography--${type}`, `ui-typography--${size}`]"><slot /></component></template>
<style scoped lang="scss" src="../styles/ui/Typography.scss"></style>
