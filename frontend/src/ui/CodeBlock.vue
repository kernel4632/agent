<!-- 代码块：高亮、行号、复制；mermaid 块动态渲染成图，语法错误回退源码。示例：<CodeBlock :code="source" language="js" /> -->
<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import hljs from 'highlight.js'
import Button from './Button.vue'
const props = defineProps({ code: { type: String, default: '' }, language: { type: String, default: 'text' }, lineNumbers: Boolean })
const status = ref('复制')
let timer
const highlighted = computed(() => hljs.highlight(props.code, { language: hljs.getLanguage(props.language) ? props.language : 'plaintext', ignoreIllegals: true }).value)

// --- mermaid：按需加载渲染成 SVG；语法错误回退显示源码 ---
const isMermaid = computed(() => props.language === 'mermaid')
const diagram = ref('')
const diagramError = ref('')
let mermaidLib = null

// mermaid 的渲染器是全局单例，并发 render 会互相污染甚至卡死；所有图表排队逐个画。
let renderQueue = Promise.resolve()
const enqueue = task => {
    const run = renderQueue.then(task, task)
    renderQueue = run.catch(() => undefined)
    return run
}

const loadMermaid = async () => {
  if (!mermaidLib) {
    mermaidLib = import('mermaid').then(module => ({
      // 每次渲染前都重新 initialize：主题跟界面走（暗色用暗主题，浅色用中性主题），
      // 重复 initialize 是官方支持的配置方式；securityLevel strict 转义图内 HTML。
      configure: () => module.default.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'neutral',
      }),
      mermaid: module.default,
    }))
  }
  return mermaidLib
}

async function draw() {
  if (!isMermaid.value) { diagram.value = ''; diagramError.value = ''; return }
  // mermaid 的临时元素按 id 挂在全局 DOM 上，两个组件实例不能撞 id，用随机 id 保证唯一。
  const id = `mermaid-${crypto.randomUUID()}`
  await enqueue(async () => {
    try {
      const { mermaid, configure } = await loadMermaid()
      configure()
      const { svg } = await mermaid.render(id, props.code)
      diagram.value = svg
      diagramError.value = ''
    } catch (error) {
      // 渲染失败就亮出源码，模型能自己读到错误继续改；错误只取第一行，hash 对象不进界面。
      diagram.value = ''
      diagramError.value = String(error?.message || error).split('\n')[0]
    } finally {
      // mermaid 失败时会把错误提示元素留在 body 尾部（id 为 d<renderId>），拿走它免得页面上多出一行裸错误。
      document.getElementById(`d${id}`)?.remove()
    }
  })
}

watch([isMermaid, () => props.code], draw, { immediate: true })

// mermaid 的 SVG 颜色是渲染时烧进去的具体色值，不跟 CSS 变量走；
// 界面切主题后要按新主题重画一遍，否则暗底上留着浅色主题的深色文字。
onMounted(() => window.addEventListener('agent-theme', draw))
onBeforeUnmount(() => { window.removeEventListener('agent-theme', draw); clearTimeout(timer) })

async function copy() {
  try { await navigator.clipboard.writeText(props.code); status.value = '已复制' }
  catch { status.value = '复制失败' }
  clearTimeout(timer)
  timer = setTimeout(() => { status.value = '复制' }, 2000)
}
</script>
<template><figure class="ui-code-block"><figcaption><span>{{ language }}</span><Button variant="text" size="small" :aria-label="status === '已复制' ? '已复制' : '复制代码'" @click="copy">{{ status }}</Button></figcaption><div v-if="isMermaid && diagram" class="ui-code-block__mermaid" v-html="diagram"></div><div v-else class="ui-code-block__body"><p v-if="diagramError" class="ui-code-block__mermaid-error">{{ diagramError }}</p><pre v-if="lineNumbers" class="ui-code-block__numbers" aria-hidden="true">{{ code.split('\n').map((_, index) => index + 1).join('\n') }}</pre><pre><code v-html="highlighted"></code></pre></div></figure></template>
<style scoped lang="scss" src="../styles/ui/CodeBlock.scss"></style>
