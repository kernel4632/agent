<!--
连接错误条：后端连不上时显示 KIMA Alert，重试动作交给 UI.retry()。
调用示例：<ConnectionError v-if="store.ui.errorMessage" :message="store.ui.errorMessage" />
-->
<script setup>
import { KimaAlert } from '@kernel4632/kima'
import { Button } from '../ui/index.js'
import { UI } from '../commands/ui.js'

defineProps({
  message: { type: String, default: '' },               // 后端返回的连接或协议错误文案
})
</script>

<template>
  <KimaAlert
    class="connection-error"
    variant="danger"
    heading="无法连接后端"
    :description="message"
  >
    <template #action>
      <Button variant="text" @click="UI.retry()">重试</Button>
    </template>
  </KimaAlert>
</template>

<style scoped lang="scss">
.connection-error { margin: 8px var(--la-content-inset) 12px; }
</style>
