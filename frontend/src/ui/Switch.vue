<!-- 开关：原生 checkbox 提供键盘和禁用语义。示例：<Switch v-model="enabled" label="启用" /> -->
<script setup>
defineProps({ modelValue: Boolean, label: String, disabled: Boolean, hideLabel: Boolean })
defineEmits(['update:modelValue'])
</script>
<template>
  <label class="ui-switch" :class="{ 'is-disabled': disabled }">
    <span class="ui-switch__control">
      <input type="checkbox" role="switch" :aria-label="label" :checked="modelValue" :disabled="disabled" @change="$emit('update:modelValue', $event.target.checked)" />
      <span class="ui-switch__track"><span class="ui-switch__thumb"></span></span>
    </span>
    <span v-if="label" :class="{ 'sr-only': hideLabel }">{{ label }}</span>
  </label>
</template>
<style scoped lang="scss" src="../styles/ui/Switch.scss"></style>
