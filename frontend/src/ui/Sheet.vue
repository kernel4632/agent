<!--
底部弹层：保留 open/label API，实际渲染 KIMA 的 KimaDrawer（bottom）。
桌面端把面板限制在和聊天区同一档的宽度并居中，手机端仍然铺满。
始终挂载：关闭时要等 KIMA 的滑出动画结束，v-if 会把动画一起拆掉。
调用示例：<Sheet :open="open" label="选择模型" @update:open="open = $event">...</Sheet>
-->
<script setup>
import { KimaDrawer } from '@kernel4632/kima'

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
  <KimaDrawer
    class="app-sheet"
    :style="{ '--app-sheet-width': `${width}px` }"
    :open="open"
    :title="label || undefined"
    :description="description || undefined"
    placement="bottom"
    @update:open="emit('update:open', $event)"
  ><slot /></KimaDrawer>
</template>

<style scoped lang="scss">
/* KIMA 的底部面板默认铺满视口；桌面端收窄到聊天宽度，标题和内容才能对齐。 */
:global(.app-sheet .kima-drawer__panel) {
  width: 100%;
  max-width: var(--app-sheet-width, 880px);
  margin-inline: auto;
}
</style>
