<!--
组件预览页：展示当前正在制作的通用应用侧边栏。
展开与收起状态由组件内部预览交互控制。
调用示例：<Sidebar />。
-->
<script setup>
import Sidebar from './components/Sidebar.vue'               // 引入待确认的侧边栏

const previewConversations = [                                // 仅为预览页提供可滚动的样例数据
  { id: 'conversation-1', title: '欢迎使用 Agent' },
  { id: 'conversation-2', title: '设计一个新的工作流' },
  { id: 'conversation-3', title: '整理项目开发计划' },
]
</script>

<template>
  <m3e-theme color="#a0a0a0" scheme="dark" density="0">
    <main class="preview-page">
      <Sidebar :conversations="previewConversations" active-conversation-id="conversation-1" /> <!-- 只展示一个待确认组件 -->
    </main>
  </m3e-theme>
</template>
