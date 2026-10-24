<!--
通用输入框：保留原来的 Field API（label/caption/multiline/size/leading/trailing），
实际渲染 KIMA 的 KimaTextField / KimaTextarea。KIMA 不画可见标签，caption 由本层排版。
调用示例：<Field v-model="query" label="搜索会话" placeholder="搜索会话" />
-->
<script setup>
import { computed, ref, useAttrs } from 'vue'
import { KimaTextarea, KimaTextField } from '@kernel4632/kima'

defineOptions({ inheritAttrs: false })

const fieldRef = ref(null)
defineExpose({ focus: () => fieldRef.value?.focus() })

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  type: { type: String, default: 'text' },
  placeholder: { type: String, default: '' },
  label: { type: String, default: '' },
  caption: { type: String, default: '' },
  disabled: Boolean,
  multiline: Boolean,
  rows: { type: [Number, String], default: undefined },
  size: { type: String, default: 'normal' },
})
const emit = defineEmits(['update:modelValue', 'change'])
const attrs = useAttrs()

const rootAttrs = computed(() => ({ class: attrs.class, style: attrs.style }))
const controlAttrs = computed(() => {
  const rest = { ...attrs }
  delete rest.class
  delete rest.style
  return rest
})
</script>

<template>
  <label v-bind="rootAttrs" class="ui-field" :class="{ 'ui-field--labeled': caption, 'ui-field--small': size === 'small' }">
    <span v-if="caption" class="ui-field__caption">{{ caption }}</span>
    <span class="ui-field__control">
      <span v-if="$slots.leading" class="ui-field__leading"><slot name="leading" /></span>
      <KimaTextarea
        v-if="multiline"
        ref="fieldRef"
        v-bind="controlAttrs"
        :model-value="String(modelValue ?? '')"
        :label="label || caption || undefined"
        :placeholder="placeholder || undefined"
        :rows="Number(rows) || 4"
        :disabled="disabled"
        @update:model-value="emit('update:modelValue', $event)"
        @change="emit('change', $event)"
      />
      <KimaTextField
        v-else
        ref="fieldRef"
        v-bind="controlAttrs"
        :model-value="String(modelValue ?? '')"
        :type="type"
        :label="label || caption || undefined"
        :placeholder="placeholder || undefined"
        :disabled="disabled"
        @update:model-value="emit('update:modelValue', $event)"
        @change="emit('change', $event)"
      />
      <span v-if="$slots.trailing" class="ui-field__trailing"><slot name="trailing" /></span>
    </span>
  </label>
</template>

<style scoped lang="scss">
.ui-field { width: 100%; min-width: 0; }
.ui-field--labeled { display: grid; gap: 6px; }
.ui-field__caption { color: var(--kima-color-on-surface-variant); font-size: 13px; line-height: 20px; }
.ui-field__control { display: flex; width: 100%; min-width: 0; align-items: center; gap: 8px; }
.ui-field__leading, .ui-field__trailing { display: inline-flex; flex: none; align-items: center; color: var(--kima-color-on-surface-variant); }
.ui-field--small { --kima-field-height: 40px; --kima-field-padding: 12px; }
.ui-field__control > :deep(.kima-text-field),
.ui-field__control > :deep(.kima-textarea) { flex: 1; min-width: 0; }
</style>
