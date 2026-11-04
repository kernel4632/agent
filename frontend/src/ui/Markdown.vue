<!--
自有 Markdown：代码块交给 CodeBlock；标题和段落用原生语义元素。
列表、表格、引用等块仍由 Marked 生成 HTML，再交给现有 markdown-body 样式。
调用示例：<Markdown :content="text" compact />
-->
<script setup>
import { computed } from 'vue'
import CodeBlock from './CodeBlock.vue'
import { useSmoothText } from '../utils/smooth-text.js'
import { lexMarkdown, renderInline, renderToken } from '../utils/markdown.js'

const props = defineProps({
  content: { type: String, default: '' },
  compact: Boolean,
  smooth: Boolean,
})

const { text } = useSmoothText(computed(() => props.smooth ? props.content : ''))
const blocks = computed(() => lexMarkdown((props.smooth ? text.value : props.content) || '').filter(token => token.type !== 'space'))
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

// 短单元格不折行：像“第 34 行”这种只有一两行的内容，交给浏览器按完整宽度分列，
// 避免出现最后一行只剩一个字的瑕疵；长正文仍然正常换行。
const SHORT_CELL = 16
function fitTables(root) {
  if (!root?.querySelector('table')) return
  for (const cell of root.querySelectorAll('td')) {
    const text = (cell.textContent || '').replace(/\s+/g, ' ').trim()
    const block = cell.querySelector('br, img, pre, ul, ol, p, div')
    cell.classList.toggle('md-cell--nowrap', text.length > 0 && text.length <= SHORT_CELL && !block)
  }
}
const vTableFit = { mounted: fitTables, updated: fitTables }
</script>

<template>
  <div class="markdown-body ui-md" v-table-fit :class="{ 'ui-md--compact': compact }">
    <template v-for="(token, index) in blocks" :key="index">
      <CodeBlock
        v-if="token.type === 'code' && closedCode(token)"
        :code="token.text"
        :language="token.lang || 'text'"
        :line-numbers="token.text.split('\n').length > 8"
      />
      <pre v-else-if="token.type === 'code'" class="ui-md__code-fallback"><code>{{ token.text }}</code></pre>
      <component
        v-else-if="token.type === 'heading'"
        :is="`h${token.depth}`"
        class="ui-typography ui-typography--heading"
        :class="`ui-typography--${headingSize(token.depth)}`"
      >
        <span v-html="inlineHTML(token)"></span>
      </component>
      <p v-else-if="token.type === 'paragraph'" class="ui-typography ui-typography--body ui-typography--body-medium">
        <span v-html="inlineHTML(token)"></span>
      </p>
      <div v-else-if="token.type === 'table'" class="ui-md__table" v-html="renderToken(token)"></div>
      <div v-else class="ui-md__block" v-html="renderToken(token)"></div>
    </template>
  </div>
</template>

<style lang="scss" src="../styles/ui/Markdown.scss"></style>
