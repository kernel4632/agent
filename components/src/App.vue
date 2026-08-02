<!--
组件预览页：展示当前正在制作的通用应用侧边栏。
展开与收起状态由组件内部预览交互控制。
调用示例：<Sidebar />。
-->
<script setup>
import Sidebar from './components/Sidebar.vue'               // 引入待确认的侧边栏
</script>

<template>
  <m3e-theme color="#a0a0a0" scheme="dark" density="0">
    <main class="preview-page">
      <Sidebar />                                               <!-- 只展示一个待确认组件 -->
    </main>
  </m3e-theme>
</template>
