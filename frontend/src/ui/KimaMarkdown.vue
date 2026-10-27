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

<style scoped lang="scss">
.kima-md { display: block; }
.kima-md :deep(.kima-typography) {
  max-width: none;
  margin: 0 0 10px;
}
.kima-md :deep(.kima-typography:last-child) { margin-bottom: 0; }
.kima-md :deep(.kima-code-block) { margin: 10px 0; }
.kima-md__code-fallback {
  max-width: 100%;
  max-height: 300px;
  overflow: auto;
  margin: 10px 0;
  padding: 10px 12px;
  border: .5px solid var(--la-line);
  border-radius: 10px;
  background: var(--la-layer-02);
  color: var(--la-text);
  font: 12.5px/1.7 var(--la-font-mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.kima-md__block > :first-child { margin-top: 0; }
.kima-md__block > :last-child { margin-bottom: 0; }
.kima-md--compact :deep(.kima-typography--body) { font-size: 14px; line-height: 1.7; }
.kima-md--compact :deep(.kima-typography--heading) { font-size: 15px; }
</style>
