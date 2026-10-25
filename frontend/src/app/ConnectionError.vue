<!--
连接错误条：后端连不上时横在页面上方的提示和重试入口。
只显示传入的 message，重试交给 UI.retry()；不直接读配置，也不管加载流程。
调用示例：<ConnectionError v-if="store.ui.errorMessage" :message="store.ui.errorMessage" />
-->
<script setup>
import { AppIcon, Button } from '../ui/index.js'
import { UI } from '../commands/ui.js'

defineProps({
  message: { type: String, default: '' },               // 后端返回的连接或协议错误文案
})
</script>

<template>
  <div class="connection-error" role="alert">
    <AppIcon name="info" :size="18" /><span>无法连接后端：{{ message }}</span>
    <Button variant="ghost" @click="UI.retry()">重试</Button>
  </div>
</template>

<style scoped lang="scss">
.connection-error { display: flex; align-items: center; gap: 12px; margin: 8px var(--la-content-inset) 12px; padding: 10px 12px 10px 16px; border-radius: 16px; background: color-mix(in srgb, var(--la-danger) 10%, transparent); color: var(--la-danger); font-size: 14px; line-height: 22px; }
.connection-error span { flex: 1; overflow-wrap: anywhere; }
@media (max-width: 767px) {
  .connection-error { margin-inline: 8px; }
}
</style>
