<!--
通用弹窗：保留 open/label API，实际渲染 KIMA 的 KimaDialog。
标题、关闭按钮、遮罩、焦点陷阱和层次都由 KIMA 处理；内容仍由调用方通过默认插槽传入。
始终挂载：KIMA 的关闭动画发生在组件内部，用 v-if 拆掉会让弹窗直接消失。
调用示例：<Dialog :open="open" label="重命名会话" @update:open="open = $event">...</Dialog>
-->
<script setup>
import { KimaDialog } from '@kernel4632/kima'

defineProps({
  open: Boolean,
  label: { type: String, default: '' },
})
const emit = defineEmits(['update:open'])
</script>

<template>
  <KimaDialog
    :open="open"
    :title="label || undefined"
    size="small"
    @update:open="emit('update:open', $event)"
  >
    <slot />
    <template v-if="$slots.footer" #footer><slot name="footer" /></template>
  </KimaDialog>
</template>
