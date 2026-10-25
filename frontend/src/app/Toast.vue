<!--
全局提示条：用 KIMA Notification 显示一条短消息，关闭或超时后交给调用方清空。
调用示例：<Toast v-if="store.ui.toast" :message="store.ui.toast" @close="store.ui.toast = ''" />
-->
<script setup>
import { KimaNotification } from '@kernel4632/kima'

defineProps({
  message: { type: String, default: '' },               // 要显示的提示文字
})

const emit = defineEmits(['close'])
</script>

<template>
  <KimaNotification
    :open="!!message"
    position="bottom-center"
    variant="info"
    :message="message"
    :duration="4000"
    @close="emit('close')"
  />
</template>
