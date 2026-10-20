<!--
全局提示条：显示一条短消息，点关闭按钮时通过 close 交给调用方清空。
调用示例：<Toast v-if="!settingsOpen" :message="store.ui.toast" @close="store.ui.toast = ''" />
-->
<script setup>
import AppIcon from '../components/AppIcon.vue'
import IconButton from '../ui/IconButton.vue'

defineProps({
  message: { type: String, default: '' },               // 要显示的提示文字
})

const emit = defineEmits(['close'])
</script>

<template>
  <div v-if="message" class="app-toast" role="status">
    <AppIcon name="info" :size="16" />{{ message }}
    <IconButton label="关闭提示" @click="emit('close')"><AppIcon name="close" :size="13" /></IconButton>
  </div>
</template>

<style scoped lang="scss">
.app-toast { position: fixed; z-index: 60; bottom: 16px; left: 50%; display: flex; align-items: center; gap: 8px; max-width: calc(100vw - 32px); padding: 8px 10px; border-radius: 6px; background: var(--la-layer-01); color: var(--la-text); box-shadow: var(--la-shadow-overlay); font-size: 13px; transform: translateX(-50%); }
</style>
