<!--
模型说的一段话：Markdown 渲染，没有气泡，像正文一样铺开。
流式时匀速追上已收到的文字（布局不跳），末尾跟一个光标；结束后立刻显示全文。
调用示例：<component :is="Components.AssistantMessage" :text="text" :live="true" />
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { marked } from 'marked'

// 模型输出里的原始 HTML 一律按文字显示，不执行。
marked.use({ renderer: { html: ({ text }) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') } })

const props = defineProps<{ text: string; live: boolean }>()
const shown = ref(props.live ? 0 : props.text.length)
let frame = 0

// 每帧追一点：落后越多追得越快，保证不会被积压的片段拖住。
function tick() {
  const gap = props.text.length - shown.value
  if (gap > 0) shown.value += Math.max(1, Math.ceil(gap / 12))
  frame = gap > 0 ? requestAnimationFrame(tick) : 0
}
watch(() => [props.text, props.live], () => {
  if (!props.live) { shown.value = props.text.length; return }
  if (!frame) frame = requestAnimationFrame(tick)
}, { immediate: true })
onBeforeUnmount(() => cancelAnimationFrame(frame))

const html = computed(() => marked.parse(props.text.slice(0, shown.value), { async: false }) as string)
</script>

<template>
  <div class="assistant" :class="{ 'is-live': live }" v-html="html" />
</template>

<style scoped>
.assistant { color: var(--text); font-size: 16px; line-height: 1.75; word-break: break-word; }
.assistant :deep(> :first-child) { margin-top: 0; }
.assistant :deep(> :last-child) { margin-bottom: 0; }
.assistant :deep(p), .assistant :deep(ul), .assistant :deep(ol), .assistant :deep(pre), .assistant :deep(table) { margin: 0 0 14px; }
.assistant :deep(ul), .assistant :deep(ol) { padding-left: 22px; }
.assistant :deep(li) { margin: 4px 0; }
.assistant :deep(strong) { font-weight: 600; }
.assistant :deep(code) { padding: 2px 6px; border-radius: 6px; background: var(--soft); font: .86em var(--mono); }
.assistant :deep(pre) { padding: 14px 16px; border-radius: 16px; background: var(--soft); overflow: auto; }
.assistant :deep(pre code) { padding: 0; background: none; }
.assistant :deep(table) { border-collapse: collapse; font-size: 14px; display: block; overflow-x: auto; }
.assistant :deep(th), .assistant :deep(td) { padding: 8px 14px; border-bottom: 1px solid var(--line); text-align: left; }
.assistant :deep(th) { font-weight: 600; }
.assistant :deep(a) { color: var(--accent); }
.is-live :deep(> :last-child)::after { content: ''; display: inline-block; width: 8px; height: 8px; margin-left: 4px; border-radius: 50%; background: var(--text); vertical-align: middle; animation: pulse 1s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .25; } }
</style>
