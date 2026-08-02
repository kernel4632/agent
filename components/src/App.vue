<!--
组件预览页：只展示一个 Grok 输入框，不放页面导航、业务数据或其他组件。
组件确认视觉后，可以把 ChatComposer.vue 直接迁移到正式前端。
调用示例：<ChatComposer />。
-->
<script setup>
import ChatComposer from './components/ChatComposer.vue'     // 引入待确认的对话编辑器
</script>

<template>
  <m3e-theme color="#a0a0a0" scheme="dark" density="0">
    <main class="preview-page">
      <ChatComposer />                                         <!-- 只展示一个待确认组件 -->
    </main>
  </m3e-theme>
</template>
