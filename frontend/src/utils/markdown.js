/*
Markdown 展示工具：组合 GFM、代码高亮和 KaTeX，并将最终 HTML 统一安全清理。
Mermaid 和代码复制需要真实 DOM，因此这里只生成带语义类名的静态结构。
调用示例：renderMarkdown('```js\nconst ready = true\n```')。
*/
import DOMPurify from 'dompurify'                         // 引入最终 HTML 安全清理能力
import hljs from 'highlight.js/lib/common'               // 引入常见语言集合，避免把全部语法塞入首屏包
import { Marked } from 'marked'                          // 引入可隔离配置的 Markdown 解析器
import { markedHighlight } from 'marked-highlight'      // 引入 Marked 与 highlight.js 桥接扩展
import markedKatex from 'marked-katex-extension'        // 引入行内和块级数学公式扩展

const markdown = new Marked(                             // 创建对话专用解析器，避免污染其他调用方
  markedHighlight({
    langPrefix: 'hljs language-',                        // 输出语言类供样式和 Mermaid 生命周期识别
    highlight(code, language) {
      if (language === 'mermaid') return escapeHTML(code) // Mermaid 源码安全编码后留给完成消息渲染
      if (language && hljs.getLanguage(language)) return hljs.highlight(code, { language, ignoreIllegals: true }).value // 已知语言使用精确语法
      return hljs.highlightAuto(code).value              // 未声明语言时使用安全自动检测
    },
  }),
  markedKatex({ throwOnError: false, output: 'htmlAndMathml' }), // 错误公式保留原文并提供可访问 MathML
)

markdown.use({                                           // 配置聊天文本的 GFM 和链接输出
  breaks: true,                                          // 单换行直接形成聊天可见换行
  gfm: true,                                             // 启用表格和任务列表等 GFM 结构
  renderer: {
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens)      // 保留链接文字中的 Markdown 格式
      let destination = href                             // 默认保留站内相对链接
      try {
        const parsed = new URL(href, window.location.href) // 解析协议以排除非网页外链
        if (!['http:', 'https:'].includes(parsed.protocol) && parsed.origin !== window.location.origin) destination = '' // 外部危险协议交给清理前先移除
      } catch {
        destination = ''                                 // 无法解析的地址不生成可点击目标
      }
      const safeTitle = title ? ` title="${escapeHTML(title)}"` : '' // 标题属性编码后保留纯文本
      return destination ? `<a href="${escapeHTML(destination)}"${safeTitle}>${label}</a>` : label // 无安全目标时仍保留可读标签
    },
  },
})


// --- 编码 HTML 特殊字符 ---
function escapeHTML(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]) // 保留源码文字而不生成可执行标签或属性
}


// --- 转换安全 Markdown ---
export function renderMarkdown(content = '') {
  const html = markdown.parse(content)                 // 将模型正文转换为 GFM、代码和公式结构
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'] }) // 清理脚本和危险属性后交给组件增强
}
