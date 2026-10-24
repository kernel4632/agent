<!--
通用开关：保留 label/modelValue API，实际渲染 KIMA 的 KimaSwitch。
调用示例：<Switch :model-value="enabled" label="启用" @update:model-value="save" />
-->
<script setup>
import { KimaSwitch } from '@kernel4632/kima'

defineProps({
  modelValue: Boolean,
  label: { type: String, default: '' },
  disabled: Boolean,
})
const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <KimaSwitch
    :model-value="modelValue"
    :disabled="disabled"
    @update:model-value="emit('update:modelValue', $event)"
  >{{ label }}</KimaSwitch>
</template>
