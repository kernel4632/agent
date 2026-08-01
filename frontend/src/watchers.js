/*
数据监听：集中处理真正由数据变化自动触发的前端副作用。
当前只保留 Markdown 增强和消息滚动；业务修改继续来自 commands。
*/
import { watch } from 'vue'                                           // 引入 Vue 响应式监听


// --- 启动全局监听 ---
export function startWatchers() {
  // API 接入前没有需要跨页面持久化的自动副作用，保留统一入口供后续扩展。
}


// --- 监听消息时间线变化 ---
export function watchMessages(readMessages, scrollToLatest) {
  return watch(readMessages, scrollToLatest, { deep: true })          // 文本、工具和审批变化后保持最新反馈
}


// --- 监听 Markdown 内容变化 ---
export function watchMarkdownContent(readContent, enhanceContent) {
  return watch(readContent, enhanceContent, { flush: 'post' })        // DOM 写入后增强链接、代码和 Mermaid
}
