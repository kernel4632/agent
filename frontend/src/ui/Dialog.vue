<!--
通用弹窗：保留 open/label API，实际渲染 KIMA 的 KimaDialog。
标题、关闭按钮、遮罩、焦点陷阱和层次都由 KIMA 处理；内容仍由调用方通过默认插槽传入。
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
    v-if="open"
    :open="open"
    :title="label || undefined"
    size="small"
    @update:open="emit('update:open', $event)"
  ><slot /></KimaDialog>
</template>
