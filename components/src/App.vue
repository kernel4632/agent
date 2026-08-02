<!--
组件预览页：展示当前正在制作的对话流组件。
用户消息参考 Grok，Assistant 活动流参考 Roo Code。
调用示例：<ConversationFlow />。
-->
<script setup>
import ConversationFlow from './components/ConversationFlow.vue' // 引入待确认的对话流
</script>

<template>
  <m3e-theme color="#a0a0a0" scheme="dark" density="0">
    <main class="preview-page">
      <ConversationFlow />
    </main>
  </m3e-theme>
</template>
