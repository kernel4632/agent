<!--
模型说的一段话：Markdown 渲染，没有气泡，像正文一样铺开。
解析交给 markstream-vue（旧前端同款）：它按块增量解析，没写完的加粗、表格、代码块也能稳稳显示，不会整段闪烁重排。
流式时匀速追上已收到的文字（布局不跳），末尾跟一个光标；结束后立刻显示全文。
颜色只表达结构：标题和加粗是暖橙（扫一眼就看到重点），链接蓝、行内代码绿、引用退成次要文字；变量都在 App.vue。
代码块换成组件表里的 CodeBlock，扩展换掉它就能改所有代码块。
调用示例：<component :is="Components.AssistantMessage" :text="text" :live="true" />
-->
<script lang="ts">
import { defineComponent, h } from 'vue'
import { setCustomComponents } from 'markstream-vue'
import 'markstream-vue/index.css'
import { Components } from '../Extension'

// 每次渲染时才去组件表里取 CodeBlock，扩展后来换掉也立刻生效。
setCustomComponents('answer', {
  code_block: defineComponent({
    props: { node: { type: Object, required: true } },
    setup: block => () => h(Components.CodeBlock, { code: block.node.code ?? '', language: block.node.language }),
  }),
})
</script>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import MarkdownRender from 'markstream-vue'

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
</script>

<template>
  <div class="assistant" :class="{ 'is-live': live }">
    <MarkdownRender
      custom-id="answer" mode="chat" html-policy="escape" :content="text.slice(0, shown)" :final="!live"
      :fade="false" :typewriter="false" :smooth-streaming="false" :max-live-nodes="220" :viewport-priority="false"
    />
  </div>
</template>

<style scoped>
.assistant { color: var(--text); font-size: 16px; line-height: 1.75; overflow-wrap: anywhere; }
/* markstream 在自己的根上重设字号变量，这里改回跟随本组件。 */
.assistant :deep(.markstream-vue) { --ms-text-body: 16px; --ms-leading-body: 1.75; font-size: inherit; line-height: inherit; content-visibility: visible; contain-intrinsic-size: none; }
.assistant :deep(:is(.paragraph-node, .list-node, .blockquote, .table-node-wrapper)) { margin: 0 0 14px; }
.assistant :deep(.paragraph-node) { font-size: inherit; line-height: inherit; }
/* markstream 每块包两层 .node-slot > .node-content，首尾块的外边距要落到真正的元素上。 */
.assistant :deep(.node-slot:first-child > .node-content > *) { margin-top: 0; }
.assistant :deep(.node-slot:last-child > .node-content > *) { margin-bottom: 0; }
/* 标题属于下一段：上方留白大于下方；字号克制，靠颜色和粗细分层。 */
.assistant :deep(.heading-node) { margin: 22px 0 8px; color: var(--md-heading); font-weight: 600; line-height: 1.45; }
.assistant :deep(.heading-1) { font-size: 21px; }
.assistant :deep(.heading-2) { font-size: 19px; }
.assistant :deep(:is(.heading-3, .heading-4, .heading-5, .heading-6)) { font-size: 16.5px; }
.assistant :deep(.strong-node) { color: var(--md-strong); font-weight: 600; }
.assistant :deep(.emphasis-node) { color: var(--md-em); }
.assistant :deep(.link-node) { color: var(--md-link); text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--md-link) 35%, transparent); text-underline-offset: 3px; }
.assistant :deep(.link-node:hover) { text-decoration-color: currentColor; }
.assistant :deep(.inline-code) { padding: 1px 5px; border-radius: 6px; background: color-mix(in srgb, var(--md-code) 10%, transparent); color: var(--md-code); font: .87em var(--mono); }
.assistant :deep(.list-node) { padding-left: 22px; font-size: inherit; line-height: inherit; }
.assistant :deep(.list-item) { margin: 4px 0; padding-left: 2px; font-size: inherit; line-height: inherit; }
.assistant :deep(.list-item > .paragraph-node) { margin: 0; }
.assistant :deep(.list-item::marker) { color: var(--md-list); font-weight: 600; }
.assistant :deep(.blockquote) { padding: 2px 0 2px 14px; border-left: 3px solid var(--md-quote); color: var(--muted); }
.assistant :deep(.blockquote > .paragraph-node) { margin: 0; }
.assistant :deep(.hr-node) { margin: 20px 0; border: 0; border-top: 1px solid var(--line); }
/* 表格：外框圆角，格线很浅，表头沿用标题色；窄屏横向滚动。 */
.assistant :deep(.table-node-wrapper) { max-width: 100%; overflow-x: auto; scrollbar-gutter: auto; border: 1px solid var(--line); border-radius: 12px; }
.assistant :deep(.table-node) { width: 100%; margin: 0; border: 0; border-collapse: collapse; table-layout: auto; font-size: 14.5px; line-height: 1.6; background: none; box-shadow: none; }
.assistant :deep(.table-node :is(th, td)) { padding: 8px 14px; border: 0; border-bottom: 1px solid var(--line-soft); color: var(--text); text-align: left; vertical-align: top; }
.assistant :deep(.table-node th) { background: var(--soft) !important; color: var(--md-heading); font-weight: 600; white-space: nowrap; }
/* 代码不折行、文字列至少留几个字宽：窄屏宁可整表横向滚动，也不把一列挤成一字一行。 */
.assistant :deep(.table-node td .inline-code) { white-space: nowrap; }
.assistant :deep(.table-node td) { min-width: 6em; }
.assistant :deep(.table-node tbody tr) { background: none !important; }
.assistant :deep(.table-node tbody tr:last-child td) { border-bottom: 0; }
.is-live :deep(.node-slot:last-child > .node-content > :is(.paragraph-node, .heading-node))::after { content: ''; display: inline-block; width: 8px; height: 8px; margin-left: 4px; border-radius: 50%; background: var(--text); vertical-align: middle; animation: pulse 1s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .25; } }
</style>
