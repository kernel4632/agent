<!--
全局提示条：用 KIMA Notification 显示一条短消息，关闭或超时后交给调用方清空。
调用示例：<Toast v-if="store.ui.toast" :message="store.ui.toast" @close="store.ui.toast = ''" />
-->
<script setup>
import { ref, watch } from 'vue'
import { KimaNotification } from '@kernel4632/kima'

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

<style scoped lang="scss">
/*
 * KIMA 0.9.7 的 notification CSS 作用域哈希和组件 JS 不一致，组件样式没有生效。
 * 这里先补上本应用实际用到的通知根节点和子节点样式；上游修复后删掉这一段。
 * 提示条默认贴底，会盖住输入框的发送/继续按钮；抬到输入框上方。
 */
:global(.app-toast.kima-notification) {
  position: fixed;
  right: auto;
  bottom: calc(104px + env(safe-area-inset-bottom));
  left: 50%;
  z-index: 1100;
  display: flex;
  width: min(420px, calc(100vw - 32px));
  max-height: calc(100dvh - 32px);
  align-items: flex-start;
  gap: 12px;
  overflow: auto;
  padding: 16px;
  border: 0;
  border-radius: var(--kima-radius-l);
  background: var(--kima-color-primary-container);
  box-shadow: var(--kima-elevation-4);
  color: var(--kima-color-on-primary-container);
  font-family: var(--kima-font-family);
  transform: translateX(-50%);
}
:global(.app-toast .kima-notification__icon) { display: inline-flex; width: 24px; height: 22px; flex: none; align-items: center; justify-content: center; opacity: .9; }
:global(.app-toast .kima-notification__copy) { display: flex; min-width: 0; flex: 1 1 auto; flex-direction: column; gap: 4px; overflow-wrap: anywhere; }
:global(.app-toast .kima-notification__message) { font-size: 14px; line-height: 1.45; }
:global(.app-toast .kima-notification__close) { display: inline-flex; width: 32px; height: 32px; flex: none; align-items: center; justify-content: center; margin-top: -6px; margin-right: -8px; border: 0; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; }
:global(.app-toast.kima-notification-enter-active) { transition: opacity var(--kima-duration-medium) var(--kima-curve-emphasized), transform var(--kima-duration-medium) var(--kima-curve-emphasized); }
:global(.app-toast.kima-notification-leave-active) { pointer-events: none; transition: opacity var(--kima-duration-fast) var(--kima-curve-standard), transform var(--kima-duration-fast) var(--kima-curve-standard); }
:global(.app-toast.kima-notification-enter-from),
:global(.app-toast.kima-notification-leave-to) { opacity: 0; transform: translateX(-50%) translateY(16px); }
</style>
