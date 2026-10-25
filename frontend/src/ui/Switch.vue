<!--
通用开关：保留 label/modelValue API，实际渲染 KIMA 的 KimaSwitch。
hide-label 用于列表行：视觉上只留开关，但把 label 放进屏幕阅读器，名称不会丢。
调用示例：<Switch :model-value="enabled" label="启用" @update:model-value="save" />
          <Switch hide-label :model-value="enabled" label="切换 read_file" @update:model-value="save" />
-->
<script setup>
import { KimaSwitch } from '@kernel4632/kima'

defineProps({
  modelValue: Boolean,
  label: { type: String, default: '' },
  disabled: Boolean,
  hideLabel: Boolean,
})
const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <KimaSwitch
    :model-value="modelValue"
    :disabled="disabled"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <span v-if="hideLabel && label" class="sr-only">{{ label }}</span>
    <template v-else>{{ label }}</template>
  </KimaSwitch>
</template>
