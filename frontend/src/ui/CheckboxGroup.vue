<!-- 多选组：把勾选结果作为数组交回页面。示例：<CheckboxGroup v-model="tools" :options="items" label="工具" /> -->
<script setup>
import Checkbox from './Checkbox.vue'
const props = defineProps({ modelValue: { type: Array, default: () => [] }, options: { type: Array, default: () => [] }, label: String, disabled: Boolean })
const emit = defineEmits(['update:modelValue'])
function choose(value, checked) { emit('update:modelValue', checked ? [...props.modelValue, value] : props.modelValue.filter(item => item !== value)) }
</script>
<template><div class="ui-checkbox-group" role="group" :aria-label="label"><Checkbox v-for="item in options" :key="item.value" :label="item.label" :disabled="disabled || item.disabled" :model-value="modelValue.includes(item.value)" @update:model-value="choose(item.value, $event)" /></div></template>
<style scoped lang="scss" src="../styles/ui/CheckboxGroup.scss"></style>
