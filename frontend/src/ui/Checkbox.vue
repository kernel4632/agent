<!-- 勾选项：原生 checkbox。示例：<Checkbox v-model="checked" label="恢复文件" /> -->
<script setup>
defineOptions({ inheritAttrs: false })
defineProps({ modelValue: Boolean, label: String, disabled: Boolean })
defineEmits(['update:modelValue'])
</script>
<template>
  <label class="ui-checkbox" :class="$attrs.class" :style="$attrs.style"><input v-bind="Object.fromEntries(Object.entries($attrs).filter(([key]) => !['class', 'style'].includes(key)))" type="checkbox" :checked="modelValue" :disabled="disabled" :aria-label="label || $attrs['aria-label']" @change="$emit('update:modelValue', $event.target.checked)" /><span v-if="label || $slots.default"><slot>{{ label }}</slot></span></label>
</template>
<style scoped lang="scss" src="../styles/ui/Checkbox.scss"></style>
