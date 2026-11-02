<!-- 标签：可选、可关闭。示例：<Chip closable @close="remove">文件.txt</Chip> -->
<script setup>
import Icon from './Icon.vue'
defineProps({ modelValue: Boolean, selectable: Boolean, closable: Boolean, disabled: Boolean, label: String })
defineEmits(['update:modelValue', 'close'])
</script>
<template>
  <span class="ui-chip" :class="{ 'is-selected': modelValue }">
    <component :is="selectable ? 'button' : 'span'" class="ui-chip__text" :type="selectable ? 'button' : undefined" :aria-pressed="selectable ? modelValue : undefined" :disabled="disabled" @click="selectable && $emit('update:modelValue', !modelValue)"><slot name="leading" /><slot /></component>
    <button v-if="closable" class="ui-chip__close" type="button" aria-label="移除附件" :title="label" :disabled="disabled" @click="$emit('close')"><Icon name="close" :size="16" /></button>
  </span>
</template>
<style scoped lang="scss" src="../styles/ui/Chip.scss"></style>
