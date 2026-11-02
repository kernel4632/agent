<!-- 数字输入：原生步进与上下限。示例：<NumberField v-model="context" label="上下文窗口" :min="0" /> -->
<script setup>
import Field from './Field.vue'
const props = defineProps({ modelValue: Number, label: String, min: Number, max: Number, step: { type: Number, default: 1 } })
const emit = defineEmits(['update:modelValue'])
function update(value) {
  const number = Number(value)
  if (value !== '' && Number.isFinite(number) && (props.min === undefined || number >= props.min) && (props.max === undefined || number <= props.max)) emit('update:modelValue', number)
}
</script>
<template><Field class="ui-number-field" type="number" :model-value="modelValue" :label="label" :min="min" :max="max" :step="step" @update:model-value="update" /></template>
<style scoped lang="scss" src="../styles/ui/NumberField.scss"></style>
