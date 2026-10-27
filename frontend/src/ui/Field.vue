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
  hint: { type: String, default: '' },
  error: { type: String, default: '' },
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
    <span
      class="ui-field__control"
      :class="{ 'ui-field__control--leading': $slots.leading, 'ui-field__control--trailing': $slots.trailing }"
    >
      <span v-if="$slots.leading" class="ui-field__leading"><slot name="leading" /></span>
      <KimaTextarea
        v-if="multiline"
        ref="fieldRef"
        v-bind="controlAttrs"
        :model-value="String(modelValue ?? '')"
        :label="label || caption || undefined"
        :placeholder="placeholder || undefined"
        :hint="hint || undefined"
        :error="error || undefined"
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
        :hint="hint || undefined"
        :error="error || undefined"
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
.ui-field--labeled { display: grid; gap: 8px; }
.ui-field__caption { color: var(--kima-color-on-surface-variant); font-size: 14px; line-height: 20px; font-weight: 500; }
.ui-field__control {
  --ui-field-inset: 20px;
  position: relative;
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 8px;
}
.ui-field__leading, .ui-field__trailing {
  position: absolute;
  top: 50%;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  color: var(--kima-color-on-surface-variant);
  transform: translateY(-50%);
}
.ui-field__leading { left: var(--ui-field-inset); pointer-events: none; }
.ui-field__trailing { right: var(--ui-field-inset); }
.ui-field__control--leading { --kima-field-padding: calc(var(--ui-field-inset) + 28px); }
.ui-field__control--trailing { --kima-field-padding: calc(var(--ui-field-inset) + 28px); }
.ui-field--small { --kima-field-height: 48px; --kima-field-padding: 16px; }
.ui-field--small .ui-field__control { --ui-field-inset: 16px; }
.ui-field--small :deep(input),
.ui-field--small :deep(textarea) { font-size: var(--kima-font-size-body-medium, 16px); }
.ui-field__control > :deep(.kima-text-field),
.ui-field__control > :deep(.kima-textarea) { flex: 1; min-width: 0; }
</style>
