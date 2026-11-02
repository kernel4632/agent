<!-- 项目按钮：原生按钮保留表单与键盘行为。示例：<Button variant="primary" @click="save">保存</Button> -->
<script setup>
import { press } from '../utils/press.js'
defineProps({
  variant: { type: String, default: 'default' },
  size: { type: String, default: 'normal' },
  disabled: Boolean,
  type: { type: String, default: 'button' },
})
defineEmits(['click'])
</script>

<template>
  <button class="ui-button" :class="[`ui-button--${variant}`, `ui-button--${size}`]" :type="type" :disabled="disabled" @pointerdown="press" @click="$emit('click', $event)"><slot /></button>
</template>

<style scoped lang="scss" src="../styles/ui/Button.scss"></style>
