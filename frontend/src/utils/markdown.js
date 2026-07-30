/*
Markdown 展示工具：将模型文本转成安全 HTML，保留代码、列表和链接格式。
marked 负责语法转换，DOMPurify 负责移除危险标签和属性，组件只负责渲染结果。
调用示例：renderMarkdown(message.content)。
*/
import DOMPurify from 'dompurify'                 // 引入模型 HTML 安全清理能力
import { marked } from 'marked'                   // 引入 Markdown 到 HTML 转换能力

marked.setOptions({                               // 配置对话消息的 Markdown 输出
  breaks: true,                                   // 单换行在聊天中直接显示
  gfm: true,                                      // 支持表格、任务列表等常见语法
})


// --- 转换安全 Markdown ---
export function renderMarkdown(content = '') {
  const html = marked.parse(content)              // 将模型正文转换为结构化 HTML
  return DOMPurify.sanitize(html)                  // 清理脚本与危险属性后交给界面
}
