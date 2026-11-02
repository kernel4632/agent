<!-- 代码块：高亮、行号与复制。示例：<CodeBlock :code="source" language="js" /> -->
<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import hljs from 'highlight.js'
import Button from './Button.vue'
const props = defineProps({ code: { type: String, default: '' }, language: { type: String, default: 'text' }, lineNumbers: Boolean })
const status = ref('复制')
let timer
const highlighted = computed(() => hljs.highlight(props.code, { language: hljs.getLanguage(props.language) ? props.language : 'plaintext', ignoreIllegals: true }).value)
async function copy() {
  try { await navigator.clipboard.writeText(props.code); status.value = '已复制' }
  catch { status.value = '复制失败' }
  clearTimeout(timer)
  timer = setTimeout(() => { status.value = '复制' }, 2000)
}
onBeforeUnmount(() => clearTimeout(timer))
</script>
<template><figure class="ui-code-block"><figcaption><span>{{ language }}</span><Button variant="text" size="small" :aria-label="status === '已复制' ? '已复制' : '复制代码'" @click="copy">{{ status }}</Button></figcaption><div class="ui-code-block__body"><pre v-if="lineNumbers" class="ui-code-block__numbers" aria-hidden="true">{{ code.split('\n').map((_, index) => index + 1).join('\n') }}</pre><pre><code v-html="highlighted"></code></pre></div></figure></template>
<style scoped lang="scss" src="../styles/ui/CodeBlock.scss"></style>
