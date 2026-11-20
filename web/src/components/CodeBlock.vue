<!--
代码块：顶栏左边语言名、右边复制图标，正文用 highlight.js 上色（颜色全来自 App.vue 的 --md-* 变量，明暗各一套）。
流式时代码还没写完也照样高亮，每次只是重算这一块；横向滚动，不撑宽对话。
放在组件表里，扩展可以整个换掉（比如把 mermaid 画成图）。
调用示例：<component :is="Components.CodeBlock" code="bun test" language="bash" />
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import hljs from 'highlight.js/lib/common'
import Icon from './Icon.vue'
import { Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons'

const props = defineProps<{ code: string; language?: string }>()
const copied = ref(false)
const language = computed(() => props.language?.trim().toLowerCase() || 'text')
const html = computed(() => hljs.highlight(props.code, { language: hljs.getLanguage(language.value) ? language.value : 'plaintext', ignoreIllegals: true }).value)

async function copy() {
  await navigator.clipboard.writeText(props.code)
  copied.value = true
  setTimeout(() => { copied.value = false }, 1500)
}
</script>

<template>
  <figure class="code">
    <figcaption class="code__head">
      <span>{{ language }}</span>
      <button class="hit" type="button" :title="copied ? '已复制' : '复制'" :aria-label="copied ? '已复制' : '复制代码'" @click="copy">
        <Icon :icon="copied ? Tick02Icon : Copy01Icon" :size="16" />
      </button>
    </figcaption>
    <pre><code class="hljs" v-html="html" /></pre>
  </figure>
</template>

<style scoped>
.code { margin: 0 0 16px; overflow: hidden; border: 1px solid var(--line); border-radius: 16px; background: var(--surface); }
.code__head { display: flex; align-items: center; justify-content: space-between; height: 40px; padding: 0 6px 0 16px; color: var(--faint); font: 12px var(--mono); }
.code__head button { display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 8px; background: none; color: inherit; cursor: pointer; }
.code__head button:hover { background: var(--hover); color: var(--text); }
.code pre { margin: 0; padding: 0 16px 14px; overflow-x: auto; font: 13px/1.65 var(--mono); tab-size: 2; }
.code :deep(.hljs-comment), .code :deep(.hljs-quote) { color: var(--md-comment); font-style: italic; }
.code :deep(:is(.hljs-keyword, .hljs-literal, .hljs-selector-tag, .hljs-doctag, .hljs-section)) { color: var(--md-keyword); }
.code :deep(:is(.hljs-title, .hljs-selector-id, .hljs-selector-class)) { color: var(--md-function); }
.code :deep(:is(.hljs-string, .hljs-regexp, .hljs-addition, .hljs-template-tag)) { color: var(--md-string); }
.code :deep(:is(.hljs-number, .hljs-symbol, .hljs-bullet, .hljs-meta)) { color: var(--md-number); }
.code :deep(:is(.hljs-type, .hljs-built_in, .hljs-name, .hljs-title.class_)) { color: var(--md-type); }
.code :deep(:is(.hljs-variable, .hljs-template-variable, .hljs-attr, .hljs-attribute)) { color: var(--md-variable); }
.code :deep(.hljs-operator) { color: var(--md-operator); }
.code :deep(.hljs-punctuation) { color: var(--muted); }
.code :deep(.hljs-deletion) { color: var(--danger); }
</style>
