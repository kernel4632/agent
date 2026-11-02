<!--
底部弹层：为 Dialog 指定底部位置和内容宽度。
桌面端把面板限制在和聊天区同一档的宽度并居中，手机端仍然铺满。
始终挂载：关闭时等待滑出动画结束，v-if 会把动画一起拆掉。
调用示例：<Sheet :open="open" label="选择模型" @update:open="open = $event">...</Sheet>
-->
<script setup>
import Dialog from './Dialog.vue'

defineProps({
  open: Boolean,
  label: { type: String, default: '' },
  description: { type: String, default: '' },
  // 面板最大宽度。内容按 560 排版时传 608（560 + 左右各 24 内边距），标题和列表才会左对齐。
  width: { type: [Number, String], default: 880 },
})
const emit = defineEmits(['update:open'])
</script>

<template>
  <Dialog
    class="app-sheet"
    :style="{ '--app-sheet-width': `${width}px` }"
    :open="open"
    :label="label"
    :description="description || undefined"
    placement="bottom"
    @update:open="emit('update:open', $event)"
  ><slot /></Dialog>
</template>

<style scoped lang="scss" src="../styles/ui/Sheet.scss"></style>
