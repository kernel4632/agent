<!-- 项目按钮：原生按钮保留表单与键盘行为。示例：<Button variant="primary" @click="save">保存</Button> -->
<script setup>
import { press } from '../utils/press.js'
defineProps({
  variant: { type: String, default: 'default' },
  size: { type: String, default: 'normal' },
  disabled: Boolean,
  icon: Boolean,
  label: String,
  title: String,
  active: Boolean,
  type: { type: String, default: 'button' },
})
const emit = defineEmits(['click'])
function activate(event) {
  // WebKit 的鼠标点击默认不聚焦按钮；先聚焦，原生 dialog 才能正确归还焦点。
  event.currentTarget.focus({ preventScroll: true })
  emit('click', event)
}
</script>

<template>
  <button :class="icon ? ['ui-icon-button', `ui-icon-button--${variant}`, `ui-icon-button--${size}`, { 'is-active': active }] : ['ui-button', `ui-button--${variant}`, `ui-button--${size}`]"
    :aria-label="label" :title="title || (icon ? label : undefined)" :type="type" :disabled="disabled" @pointerdown="press" @click="activate"><slot /></button>
</template>

<style scoped lang="scss" src="../styles/ui/Button.scss"></style>
