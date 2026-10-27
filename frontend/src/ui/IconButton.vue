<!--
通用图标按钮：保留 label/active/size API，实际渲染 KIMA 的 KimaIconButton。
active → tonal；普通 → standard；尺寸沿用 KIMA 的 small/default。
调用示例：<IconButton label="设置" title="设置" @click="openSettings"><AppIcon name="settings" /></IconButton>
-->
<script setup>
import { computed } from 'vue'
import { KimaIconButton } from '@kernel4632/kima'

const props = defineProps({
  label: { type: String, required: true },
  title: { type: String, default: '' },
  size: { type: String, default: 'normal' },
  variant: { type: String, default: '' },   // 传 text 时去掉底色，用于列表行里的小动作
  active: Boolean,
  disabled: Boolean,
  type: { type: String, default: 'button' },
})
const emit = defineEmits(['click'])
const kimaVariant = computed(() => props.variant || (props.active ? 'tonal' : 'standard'))
const kimaSize = computed(() => props.size === 'small' ? 'small' : 'default')
</script>

<template>
  <KimaIconButton
    v-bind="$attrs"
    :label="label"
    :title="title || label"
    :variant="kimaVariant"
    :size="kimaSize"
    :disabled="disabled"
    :type="type"
    @click="emit('click', $event)"
  ><slot /></KimaIconButton>
</template>
