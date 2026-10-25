<!--
通用按钮：保留原来的 variant/size API，但实际渲染 KIMA 的 KimaButton。
primary → filled，default → outlined，ghost → text，danger → text + 危险色，plain → 自定义行按钮（KIMA 没有适合导航行的 plain 尺寸）。
调用示例：<Button variant="primary" @click="save">保存</Button>
-->
<script setup>
import { computed } from 'vue'
import { KimaButton } from '@kernel4632/kima'

const props = defineProps({
  variant: { type: String, default: 'default' },
  size: { type: String, default: 'normal' },
  disabled: Boolean,
  type: { type: String, default: 'button' },
})
const emit = defineEmits(['click'])

const kimaVariant = computed(() => ({
  primary: 'filled',
  tonal: 'tonal',
  default: 'outlined',
  ghost: 'text',
  danger: 'text',
  plain: 'text',
}[props.variant] || 'outlined'))
</script>

<template>
  <button
    v-if="variant === 'plain'"
    v-bind="$attrs"
    class="ui-button ui-button--plain"
    :type="type"
    :disabled="disabled"
    @click="emit('click', $event)"
  ><slot /></button>
  <KimaButton
    v-else
    v-bind="$attrs"
    :variant="kimaVariant"
    :class="['ui-button', { 'ui-button--danger': variant === 'danger', 'ui-button--small': size === 'small' }]"
    :type="type"
    :disabled="disabled"
    @click="emit('click', $event)"
  ><slot /></KimaButton>
</template>

<style scoped lang="scss">
.ui-button--danger { color: var(--kima-color-error); }
.ui-button--small { --kima-button-min-width: 0; }
.ui-button--plain {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: inherit;
  cursor: pointer;
}
</style>
