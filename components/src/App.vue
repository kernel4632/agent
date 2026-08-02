<!--
组件预览页：展示当前正在制作的主页原型。
页面只使用 M3E 原生组件外观，自定义样式仅负责布局。
调用示例：<HomePage />。
-->
<script setup>
import HomePage from './components/HomePage.vue'              // 引入待确认的主页原型
</script>

<template>
  <m3e-theme color="#a0a0a0" scheme="dark" density="0">
    <main class="preview-page">
      <HomePage />                                               <!-- 只展示一个待确认页面 -->
    </main>
  </m3e-theme>
</template>
