<!--
平滑 Markdown：先按小步追上模型最新文字，再交给 Markdown 按块渲染。
历史内容初始化就是全文，不会重播动画；用于助手正文和步骤正文。
调用示例：<SmoothMarkdown :content="step.text" compact />
-->
<script setup>
import { computed } from 'vue'
import { useSmoothText } from '../utils/smooth-text.js'
import Markdown from './Markdown.vue'

const props = defineProps({
  content: { type: String, default: '' },
  compact: Boolean,
})
const { text } = useSmoothText(computed(() => props.content || ''))
</script>

<template>
  <Markdown :content="text" :compact="compact" />
</template>

<style scoped lang="scss" src="../styles/ui/SmoothMarkdown.scss"></style>
