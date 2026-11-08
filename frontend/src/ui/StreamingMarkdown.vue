<!--
  流式 Markdown：思考这类高频追加内容交给 markstream-vue 做增量解析。
  普通正文仍走 Markdown.vue，保留项目自己的代码块、Mermaid 和排版。
  调用示例：<StreamingMarkdown :content="reasoning" :final="!streaming" compact />
-->
<script setup>
import MarkdownRender from 'markstream-vue'
import 'markstream-vue/index.css'

defineProps({
  content: { type: String, default: '' },
  compact: Boolean,
  final: Boolean,
})
</script>

<template>
  <MarkdownRender
    class="markdown-body ui-md"
    :class="{ 'ui-md--compact': compact }"
    mode="chat"
    :content="content"
    :final="final"
    :fade="false"
    :smooth-streaming="false"
    :typewriter="false"
    :max-live-nodes="120"
    :render-code-blocks-as-pre="true"
  />
</template>

<style scoped lang="scss" src="../styles/ui/StreamingMarkdown.scss"></style>
