<!-- 数值滑块：input 时更新预览，change 时提交。示例：<Slider v-model="level" :max="6" @change="save" /> -->
<script setup>
defineProps({ modelValue: Number, min: { type: Number, default: 0 }, max: { type: Number, default: 100 }, step: { type: Number, default: 1 }, label: String, disabled: Boolean })
defineEmits(['update:modelValue', 'change'])
</script>
<template><input class="ui-slider" type="range" :value="modelValue" :min="min" :max="max" :step="step" :aria-label="label" :disabled="disabled" @input="$emit('update:modelValue', Number($event.target.value))" @change="$emit('change', Number($event.target.value))" /></template>
<style scoped lang="scss" src="../styles/ui/Slider.scss"></style>
