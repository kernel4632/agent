<!--
组件预览页：展示当前正在制作的设置页。
设置草稿由 SettingsPage 统一维护，离开页面时发出保存事件。
调用示例：<SettingsPage @save="persistSettings" />。
-->
<script setup>
import SettingsPage from './components/settings/SettingsPage.vue' // 引入待确认的设置页
</script>

<template>
  <m3e-theme color="#a0a0a0" scheme="dark" density="0">
    <main class="preview-page">
      <SettingsPage />
    </main>
  </m3e-theme>
</template>
