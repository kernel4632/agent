<!--
Markdown 内容组件：渲染安全富文本，并在 DOM 完成后增强代码复制、外链和 Mermaid。
流式阶段只更新轻量 Markdown；消息结束后才运行异步图表引擎，避免每个 token 重画。
调用示例：<MarkdownContent :content="message.content" :streaming="message.isStreaming" />。
-->
<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'       // 引入安全 HTML 派生和 DOM 生命周期
import DOMPurify from 'dompurify'                              // 引入 Mermaid SVG 最终清理能力
import { renderMarkdown } from '../utils/markdown.js'         // 引入 Markdown 静态结构转换
import { watchMarkdownContent } from '../watchers.js'          // 引入集中管理的内容增强监听
import { currentLanguage, t } from '../i18n.js'                // 引入响应式复制文案和语言依赖

const props = defineProps({                                   // 声明消息正文和流式状态
  content: { type: String, default: '' },                      // 当前需要展示的 Markdown 原文
  streaming: { type: Boolean, default: false },                // 为 true 时跳过昂贵 Mermaid 渲染
})

const rootElement = ref(null)                                  // 保存增强链接和代码所需的真实容器
const html = computed(() => renderMarkdown(props.content))     // 每个文本增量只同步生成安全 HTML
let mermaidPromise = null                                      // 首个完成图表出现后复用异步引擎实例


// --- 按需加载 Mermaid 引擎 ---
async function getMermaid() {
  mermaidPromise ??= import('mermaid').then(({ default: mermaid }) => { // 只在完成消息含图表时下载大型渲染器
    mermaid.initialize({                                       // 配置手动、安全、深色 Mermaid 输出
      startOnLoad: false,                                      // 图表生命周期由完成消息明确控制
      securityLevel: 'strict',                                 // 禁止图表源码注入脚本和任意交互
      theme: 'dark',                                           // 图表接入当前深色工作台
      fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', // 图表文字与应用身份一致
    })
    return mermaid                                             // 后续图表共享已配置实例
  })
  return mermaidPromise                                        // 反馈当前或已完成的加载任务
}


// --- 复制一个代码块 ---
async function copyCode(button) {
  const code = button.parentElement?.querySelector('code')     // 读取同一代码框内的原始文本
  if (!code) return                                            // 结构已更新时不执行失效动作
  try {
    await navigator.clipboard.writeText(code.textContent ?? '') // 使用浏览器权限受控剪贴板写入
    button.title = t('copied')                                  // 原位反馈命令完成
    button.setAttribute('aria-label', t('copied'))
    button.innerHTML = '<mdui-icon-check></mdui-icon-check>'
  } catch {
    button.title = t('copyFailed')                              // 权限拒绝时保留可理解反馈
    button.setAttribute('aria-label', t('copyFailed'))
    button.innerHTML = '<mdui-icon-error-outline></mdui-icon-error-outline>'
  }
  window.setTimeout(() => {
    button.title = t('copyCode')
    button.setAttribute('aria-label', t('copyCode'))
    button.innerHTML = '<mdui-icon-content-copy></mdui-icon-content-copy>'
  }, 1400) // 短暂反馈后恢复可重复命令
}


// --- 处理 Markdown 内点击命令 ---
function handleClick(event) {
  const button = event.target.closest('.markdown-code__copy')  // 只接受本组件生成的复制动作
  if (button && rootElement.value?.contains(button)) copyCode(button) // 将用户触发转换为剪贴板反馈
}


// --- 增强当前 Markdown DOM ---
async function enhanceContent() {
  await nextTick()                                             // 等待 v-html 写入本轮完整结构
  const root = rootElement.value                               // 捕获仍挂载的当前消息容器
  if (!root) return                                            // 消息卸载后不继续异步修改

  root.querySelectorAll('a[href]').forEach((link) => {         // 逐个限制外部网页链接行为
    const destination = new URL(link.href, window.location.href) // 浏览器负责规范化相对地址
    if (!['http:', 'https:'].includes(destination.protocol)) link.removeAttribute('href') // 非网页协议不可点击
    if (destination.origin !== window.location.origin) Object.assign(link, { target: '_blank', rel: 'noopener noreferrer' }) // 外链隔离新窗口上下文
  })

  root.querySelectorAll('pre').forEach((block) => {            // 为每个普通代码块加入稳定复制命令
    if (block.querySelector('.language-mermaid')) return       // Mermaid 结构另行处理
    const existingButton = block.querySelector('.markdown-code__copy') // 语言切换时更新现有命令
    if (existingButton) {
      existingButton.title = t('copyCode')
      existingButton.setAttribute('aria-label', t('copyCode'))
      return
    }
    block.dataset.enhanced = 'true'                             // 防止同一次 DOM 生命周期重复加按钮
    const button = document.createElement('mdui-button-icon')    // 创建 MDUI 图标命令
    Object.assign(button, { className: 'markdown-code__copy', title: t('copyCode') }) // 提供悬停说明
    button.setAttribute('aria-label', t('copyCode'))            // 为辅助技术声明按钮用途
    button.innerHTML = '<mdui-icon-content-copy></mdui-icon-content-copy>' // 使用已注册 MDUI 图标
    block.append(button)                                       // 命令固定在所属代码块内
  })

  if (props.streaming) return                                  // 流式文本不启动 Mermaid 解析和布局
  const diagrams = [...root.querySelectorAll('pre > code.language-mermaid')] // 只选择完成消息中的 Mermaid fenced block
  if (!diagrams.length) return                                 // 普通消息不加载 Mermaid 代码
  const mermaid = await getMermaid()                           // 首个真实图表才加载渲染引擎
  for (const [index, code] of diagrams.entries()) {
    const block = code.parentElement                            // 保存源码容器供成功后原位替换
    if (!block || block.dataset.rendering) continue             // 同一图表已有任务时避免重复绘制
    block.dataset.rendering = 'true'                            // 标记当前异步渲染归属
    try {
      const diagramID = `mermaid-${crypto.randomUUID()}-${index}` // 每个 SVG 使用 Mermaid 要求的唯一 ID
      const result = await mermaid.render(diagramID, code.textContent ?? '') // 将完成源码转换为 SVG
      if (!rootElement.value?.contains(block)) continue         // 文本更新或卸载后丢弃过期结果
      const figure = document.createElement('figure')           // 用语义容器承载可横向滚动图表
      figure.className = 'markdown-mermaid'                     // 接入工作台图表样式
      figure.innerHTML = DOMPurify.sanitize(result.svg, { USE_PROFILES: { svg: true, svgFilters: true } }) // 严格配置后仍做最终 SVG 清理
      block.replaceWith(figure)                                 // 成功后用真实图表替换源码
      result.bindFunctions?.(figure)                            // 恢复 Mermaid 声明的安全图表交互
    } catch (error) {
      block.classList.add('markdown-mermaid--error')            // 解析失败时保留源码便于检查
      block.dataset.rendering = ''                              // 允许后续内容修正后重新渲染
      block.title = error.message                               // 悬停提供解析错误，不加入教程文字
    }
  }
}

watchMarkdownContent(() => [props.content, props.streaming, currentLanguage()], enhanceContent) // 文本、状态和语言变化后增强
onMounted(enhanceContent)                                      // 历史消息首次挂载时立即增强
</script>

<template>
  <div ref="rootElement" class="markdown" @click="handleClick" v-html="html"></div>
</template>

<style lang="scss" src="../styles/components/MarkdownContent.scss"></style>
