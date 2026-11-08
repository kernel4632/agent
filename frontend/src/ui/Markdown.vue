<!--
统一 Markdown 入口：流式解析、正式渲染和历史内容全部走 markstream-vue。
代码块仍映射回项目自己的 CodeBlock，标题/段落补上项目排版类，避免两套视觉。
调用示例：<Markdown :content="text" compact />。
-->
<script setup>
import { computed, defineComponent, h } from 'vue'
import MarkdownRender, {
  HeadingNode,
  ParagraphNode,
  setCustomComponents,
} from 'markstream-vue'
import 'markstream-vue/index.css'
import CodeBlock from './CodeBlock.vue'
import { useSmoothText } from '../utils/smooth-text.js'

const props = defineProps({
  content: { type: String, default: '' },
  compact: Boolean,
  smooth: Boolean,
  // 历史内容默认已经是最终态；思考流式处显式传 false。
  final: { type: Boolean, default: true },
})

// 项目自己的代码卡片负责 Mermaid、全屏和复制；markstream 只负责增量解析。
const CUSTOM_ID = 'agent-markdown'

// markstream 会特殊拦截 mermaid 代码块，绕开它才能继续使用项目 CodeBlock。
// 语法层面改写成自定义语言，交给 code_block 映射后再还原成 mermaid。
function protectMermaid(markdown) {
  return String(markdown || '').replace(/^(\s*)(`{3,}|~{3,})mermaid\b/gm, '$1$2agent-mermaid')
}

const CodeBlockNode = defineComponent({
  name: 'AgentMarkdownCodeBlock',
  props: { node: { type: Object, required: true } },
  setup(block) {
    return () => h(CodeBlock, {
      code: block.node.code || '',
      language: block.node.language === 'agent-mermaid' ? 'mermaid' : (block.node.language || 'text'),
      lineNumbers: String(block.node.code || '').split('\n').length > 8,
    })
  },
})

const Heading = defineComponent({
  name: 'AgentMarkdownHeading',
  props: { node: { type: Object, required: true } },
  setup(heading) {
    return () => h(HeadingNode, {
      node: heading.node,
      class: ['ui-typography', 'ui-typography--heading', heading.node.depth <= 1 ? 'ui-typography--title-medium' : 'ui-typography--title-small'],
    })
  },
})

const Paragraph = defineComponent({
  name: 'AgentMarkdownParagraph',
  props: { node: { type: Object, required: true } },
  setup(paragraph) {
    return () => h(ParagraphNode, {
      node: paragraph.node,
      class: ['ui-typography', 'ui-typography--body', 'ui-typography--body-medium'],
    })
  },
})

setCustomComponents(CUSTOM_ID, {
  code_block: CodeBlockNode,
  heading: Heading,
  paragraph: Paragraph,
})

const { text, done } = useSmoothText(computed(() => props.smooth ? props.content : ''))
const rawSource = computed(() => props.smooth ? text.value : (props.content || ''))
const source = computed(() => protectMermaid(rawSource.value))

// 和旧 Markdown 一样：短单元格不折行，长正文正常换行。
function fitTables(root) {
  if (!root?.querySelector?.('table')) return
  for (const cell of root.querySelectorAll('td')) {
    const content = (cell.textContent || '').replace(/\s+/g, ' ').trim()
    const block = cell.querySelector('br, img, pre, ul, ol, p, div')
    cell.classList.toggle('md-cell--nowrap', content.length > 0 && content.length <= 16 && !block)
  }
}
const vTableFit = { mounted: fitTables, updated: fitTables }
</script>

<template>
  <MarkdownRender
    v-table-fit
    class="markdown-body ui-md markstream-vue"
    :class="{ 'ui-md--compact': compact }"
    :custom-id="CUSTOM_ID"
    mode="chat"
    :content="source"
    :final="final && done"
    :fade="false"
    :smooth-streaming="false"
    :typewriter="false"
    :max-live-nodes="220"
    :render-code-blocks-as-pre="false"
  />
</template>

<style scoped lang="scss" src="../styles/ui/Markdown.scss"></style>
