<!--
通用按钮：统一默认、主要、危险和纯文字按钮的语义。
样式复用全局 .button / .button--primary / .button--danger / .text-button，以后换组件库只改这里。
调用示例：<Button variant="primary" @click="save">保存</Button>
-->
<script setup>
import { computed } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  variant: { type: String, default: 'default' },        // default、primary、danger 或 ghost（纯文字）
  size: { type: String, default: 'normal' },            // normal 28px，small 24px
  disabled: Boolean,
  type: { type: String, default: 'button' },            // 表单提交按钮传 submit
})

const emit = defineEmits(['click'])

// ghost 用现有的文字按钮样式，其余变体继续走全局 .button 系列。
const classes = computed(() => [
  props.variant === 'ghost' ? 'text-button' : 'button',
  'ui-button',
  {
    'button--primary': props.variant === 'primary',
    'button--danger': props.variant === 'danger',
    'button--small': props.size === 'small' && props.variant !== 'ghost',
  },
])
</script>

<template>
  <button
    v-bind="$attrs"
    :class="classes"
    :type="type"
    :disabled="disabled"
    @click="emit('click', $event)"
  >
    <slot />
  </button>
</template>
