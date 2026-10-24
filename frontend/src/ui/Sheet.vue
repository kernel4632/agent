<!--
底部弹层：保留 open/label API，实际渲染 KIMA 的 KimaDrawer（bottom）。
调用示例：<Sheet :open="open" label="选择模型" @update:open="open = $event">...</Sheet>
-->
<script setup>
import { KimaDrawer } from '@kernel4632/kima'

defineProps({
  open: Boolean,
  label: { type: String, default: '' },
})
const emit = defineEmits(['update:open'])
</script>

<template>
  <KimaDrawer
    v-if="open"
    :open="open"
    :title="label || undefined"
    placement="bottom"
    @update:open="emit('update:open', $event)"
  ><slot /></KimaDrawer>
</template>
