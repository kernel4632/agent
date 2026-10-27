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
    class="app-toast"
    :open="!!message"
    position="bottom-center"
    variant="info"
    :message="message"
    :duration="4000"
    @close="emit('close')"
  />
</template>

<style scoped lang="scss">
/* 提示条默认贴底，会盖住输入框的发送/继续按钮；抬到输入框上方。 */
:global(.app-toast.kima-notification--bottom-center) {
  bottom: calc(104px + env(safe-area-inset-bottom));
}
</style>
