<!--
选择按钮：替代原生生硬 Checkbox 的自有圆角方块控件。
支持 checked / indeterminate（半选横线）两态视觉，键盘与禁用语义仍由原生 input 提供。
示例：<SelectButton v-model="checked" label="全选" />；<SelectButton :model-value="true" indeterminate disabled />
-->
<script setup>
import { computed } from 'vue' // 用 computed 把 indeterminate 映射成原生属性

const props = defineProps({
  modelValue: Boolean,                 // 是否勾选
  indeterminate: Boolean,              // 半选：显示横线，视觉上不算全选
  label: String,                       // 无障碍名称；不显示文字时也要给
  disabled: Boolean,                   // 禁用时整块变灰且不可点
})
const emit = defineEmits(['update:modelValue'])

// 半选时点击应把列表推到全选，所以勾选态视为「未满」，点击后置 true。
const stateClass = computed(() => ({
  'is-checked': props.modelValue && !props.indeterminate,
  'is-indeterminate': props.indeterminate,
  'is-disabled': props.disabled,
}))

function onChange(event) {
  emit('update:modelValue', props.indeterminate ? true : event.target.checked) // 半选点击 → 全选
}
</script>

<template>
  <label class="ui-select-button" :class="stateClass">
    <span class="ui-select-button__control">
      <input
        type="checkbox"
        :checked="modelValue"
        :disabled="disabled"
        :aria-label="label"
        :aria-checked="indeterminate ? 'mixed' : modelValue ? 'true' : 'false'"
        @change="onChange"
      />
      <span class="ui-select-button__box" aria-hidden="true">
        <svg class="ui-select-button__mark" viewBox="0 0 20 20" fill="none">
          <path class="ui-select-button__check" d="M5 10.5 8.5 14 15 6.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
          <path class="ui-select-button__dash" d="M5.5 10H14.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
        </svg>
      </span>
    </span>
    <span v-if="label" class="ui-select-button__text">{{ label }}</span>
  </label>
</template>

<style scoped lang="scss" src="../styles/ui/SelectButton.scss"></style>
