<!--
通用开关：把 checkbox 包装成 role="switch"，外观继续复用全局 .switch。
label 写入 aria-label；id、aria-* 等其余属性直接透传到底层 input。
调用示例：<Switch v-model="reduceMotion" label="减少界面动画" />
-->
<script setup>
defineOptions({ inheritAttrs: false })

defineProps({
  modelValue: Boolean,                                  // 开关是否打开，配合 v-model 使用
  label: { type: String, default: '' },                 // 屏幕阅读器读到的名称（aria-label）
  disabled: Boolean,
})

const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <input
    v-bind="$attrs"
    class="switch ui-switch"
    type="checkbox"
    role="switch"
    :checked="modelValue"
    :aria-label="label || undefined"
    :disabled="disabled"
    @change="emit('update:modelValue', $event.target.checked)"
  />
</template>
