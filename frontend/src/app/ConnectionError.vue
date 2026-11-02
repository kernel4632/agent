<!--
连接错误条：后端连不上时显示 自有 Alert，重试动作交给 UI.retry()。
调用示例：<ConnectionError v-if="store.ui.errorMessage" :message="store.ui.errorMessage" />
-->
<script setup>
import { Button } from '../ui/index.js'
import { UI } from './ui.js'

defineProps({
  message: { type: String, default: '' },               // 后端返回的连接或协议错误文案
})
</script>

<template>
  <div class="connection-error" role="alert">
    <div><strong>无法连接后端</strong><p>{{ message }}</p></div>
      <Button variant="text" @click="UI.retry()">重试</Button>
  </div>
</template>

<style scoped lang="scss" src="../styles/app/ConnectionError.scss"></style>
