<!--
全局提示条：显示一条短消息，点关闭按钮时通过 close 交给调用方清空。
调用示例：<Toast v-if="!settingsOpen" :message="store.ui.toast" @close="store.ui.toast = ''" />
-->
<script setup>
import { AppIcon, IconButton } from '../ui/index.js'

defineProps({
  message: { type: String, default: '' },               // 要显示的提示文字
})

const emit = defineEmits(['close'])
</script>

<template>
  <div v-if="message" class="app-toast" role="status">
    <AppIcon name="info" :size="18" />{{ message }}
    <IconButton size="small" label="关闭提示" @click="emit('close')"><AppIcon name="close" :size="16" /></IconButton>
  </div>
</template>

<style scoped lang="scss">
.app-toast { position: fixed; z-index: 60; bottom: 24px; left: 50%; display: flex; align-items: center; gap: 12px; max-width: calc(100vw - 32px); padding: 10px 10px 10px 20px; border-radius: 999px; background: var(--la-layer-02); color: var(--la-text); box-shadow: var(--la-shadow-overlay); font-size: 14px; transform: translateX(-50%); }
</style>
