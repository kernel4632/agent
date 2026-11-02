<!--
KIMA Markdown：按块渲染 Markdown，代码块交给 KimaCodeBlock，标题和段落交给 KimaTypography。
列表、表格、引用等块仍由 Marked 生成 HTML，再交给现有 markdown-body 样式。
调用示例：<KimaMarkdown :content="text" compact />
-->
<script setup>
import { computed } from 'vue'
import { KimaCodeBlock, KimaTypography } from '@kernel4632/kima'
import { lexMarkdown, renderInline, renderToken } from '../utils/markdown.js'

const props = defineProps({
  content: { type: String, default: '' },
  compact: Boolean,
})

const blocks = computed(() => lexMarkdown(props.content || '').filter(token => token.type !== 'space'))
const headingSize = depth => depth <= 1 ? 'title-medium' : 'title-small'

function closedCode(token) {
  const raw = String(token.raw || '').trim()
  const fence = raw.match(/^(`{3,}|~{3,})/)
  if (!fence) return true // 缩进代码块没有围栏，按完整代码处理
  return raw.endsWith(fence[1])
}

function inlineHTML(token) {
  return token.tokens?.length ? renderInline(token.tokens) : ''
}
</script>

<template>
  <div class="markdown-body kima-md" :class="{ 'kima-md--compact': compact }">
    <template v-for="(token, index) in blocks" :key="index">
      <KimaCodeBlock
        v-if="token.type === 'code' && closedCode(token)"
        :code="token.text"
        :language="token.lang || 'text'"
        :line-numbers="token.text.split('\n').length > 8"
      />
      <pre v-else-if="token.type === 'code'" class="kima-md__code-fallback"><code>{{ token.text }}</code></pre>
      <KimaTypography
        v-else-if="token.type === 'heading'"
        type="heading"
        :level="token.depth"
        :size="headingSize(token.depth)"
      >
        <span v-html="inlineHTML(token)"></span>
      </KimaTypography>
      <KimaTypography v-else-if="token.type === 'paragraph'" type="body" size="body-medium">
        <span v-html="inlineHTML(token)"></span>
      </KimaTypography>
      <div v-else class="kima-md__block" v-html="renderToken(token)"></div>
    </template>
  </div>
</template>

<style scoped lang="scss" src="../styles/ui/KimaMarkdown.scss"></style>
