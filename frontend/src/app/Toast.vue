<!--
全局提示条：用 KIMA Notification 显示一条短消息，关闭或超时后交给调用方清空。
调用示例：<Toast v-if="store.ui.toast" :message="store.ui.toast" @close="store.ui.toast = ''" />
-->
<script setup>
import { ref, watch } from 'vue'
import { KimaNotification } from '../ui/index.js'

const props = defineProps({
  message: { type: String, default: '' },               // 要显示的提示文字
})

const emit = defineEmits(['close'])

// 关闭时父层会清空 message；保留最后一条文字，退出动画才不会变成空框。
const shown = ref(props.message)
watch(() => props.message, value => { if (value) shown.value = value })
</script>

<template>
  <KimaNotification
    class="app-toast"
    :open="!!message"
    position="bottom-center"
    variant="info"
    :message="shown"
    :duration="4000"
    @close="emit('close')"
  />
</template>

<style scoped lang="scss" src="../styles/app/Toast.scss"></style>
