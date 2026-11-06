<!-- 单选组：共用原生 name，方向键移动选择。示例：<RadioGroup v-model="theme" :options="themes" label="主题" /> -->
<script setup>
import { useId } from 'vue'
import Icon from './Icon.vue'
defineProps({ modelValue: [String, Number], options: { type: Array, default: () => [] }, label: String, name: String, orientation: String, disabled: Boolean, compact: Boolean })
defineEmits(['update:modelValue'])
const id = useId()
</script>
<template>
  <div class="ui-radio-group" :class="{ 'is-horizontal': orientation === 'horizontal', 'is-compact': compact }" role="radiogroup" :aria-label="label">
    <label v-for="item in options" :key="item.value" class="ui-radio-group__item">
      <input type="radio" :name="name || id" :value="item.value" :aria-label="item.label" :checked="modelValue === item.value" :disabled="disabled || item.disabled" @change="$emit('update:modelValue', item.value)" />
      <slot name="option" :item="item" :selected="modelValue === item.value"><span>{{ item.label }}</span></slot>
      <Icon v-if="!$slots.option && modelValue === item.value" name="check" :size="16" />
    </label>
  </div>
</template>
<style scoped lang="scss" src="../styles/ui/RadioGroup.scss"></style>
