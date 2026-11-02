<!-- 图标按钮：名称始终提供给辅助技术。示例：<IconButton label="设置"><AppIcon name="settings" /></IconButton> -->
<script setup>
import { press } from '../utils/press.js'
defineProps({ label: { type: String, required: true }, title: String, size: { type: String, default: 'normal' }, variant: { type: String, default: 'standard' }, active: Boolean, disabled: Boolean, type: { type: String, default: 'button' } })
defineEmits(['click'])
</script>
<template>
  <button class="ui-icon-button" :class="[{ 'is-active': active }, `ui-icon-button--${variant}`, `ui-icon-button--${size}`]" :aria-label="label" :title="title || label" :type="type" :disabled="disabled" @pointerdown="press" @click="$emit('click', $event)"><slot /></button>
</template>
<style scoped lang="scss" src="../styles/ui/IconButton.scss"></style>
