<!--
通用按钮：统一默认、主要、危险、纯文字和 plain 按钮的语义。
样式复用全局 .button / .button--primary / .button--danger / .text-button；plain 只输出 ui-button，留给导航项和列表项自己的样式。
以后换组件库只改这里。
调用示例：<Button variant="primary" @click="save">保存</Button>
          <Button variant="plain" class="settings-back" @click="back">返回</Button>
-->
<script setup>
import { computed } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  variant: { type: String, default: 'default' },        // default、primary、danger、ghost（纯文字）或 plain（不加全局按钮外观）
  size: { type: String, default: 'normal' },            // normal 28px，small 24px
  disabled: Boolean,
  type: { type: String, default: 'button' },            // 表单提交按钮传 submit
})

const emit = defineEmits(['click'])

// plain 只保留 ui-button 标记，尺寸和视觉交给调用方；ghost 用文字按钮样式，其余变体走全局 .button 系列。
const classes = computed(() => {
  if (props.variant === 'plain') return ['ui-button']
  return [
    props.variant === 'ghost' ? 'text-button' : 'button',
    'ui-button',
    {
      'button--primary': props.variant === 'primary',
      'button--danger': props.variant === 'danger',
      'button--small': props.size === 'small' && props.variant !== 'ghost',
    },
  ]
})
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
