<!-- 输入框：原生 input/textarea，支持清空与密码可见。示例：<Field v-model="query" label="搜索" /> -->
<script setup>
import { computed, ref, useAttrs, useId } from 'vue'
import AppIcon from './AppIcon.vue'
defineOptions({ inheritAttrs: false })
const props = defineProps({
  modelValue: { type: [String, Number], default: '' }, type: { type: String, default: 'text' }, placeholder: String,
  label: String, caption: String, hint: String, error: String, disabled: Boolean, multiline: Boolean,
  rows: { type: [Number, String], default: 4 }, size: String, clearable: Boolean,
})
const emit = defineEmits(['update:modelValue', 'change'])
const field = ref(null)
const visible = ref(false)
const id = useId()
const attrs = useAttrs()
const controlAttrs = computed(() => { const { class: _, style, ...rest } = attrs; return rest })
defineExpose({ focus: () => field.value?.focus() })
function clear() { emit('update:modelValue', ''); emit('change', ''); field.value?.focus() }
</script>
<template>
  <div class="ui-field" :class="[$attrs.class, { 'ui-field--small': size === 'small', 'is-error': error }]" :style="$attrs.style">
    <label v-if="caption" :for="id" class="ui-field__caption">{{ caption }}</label>
    <div class="ui-field__control" :class="{ 'has-leading': $slots.leading, 'has-trailing': $slots.trailing || clearable || type === 'password' }">
      <span v-if="$slots.leading" class="ui-field__leading"><slot name="leading" /></span>
      <component :is="multiline ? 'textarea' : 'input'" :id="id" ref="field" v-bind="controlAttrs" class="ui-field__input" :value="modelValue" :type="visible ? 'text' : type" :rows="multiline ? Number(rows) : undefined" :aria-label="label || caption" :aria-invalid="error ? 'true' : undefined" :aria-describedby="hint || error ? `${id}-hint` : undefined" :placeholder="placeholder" :disabled="disabled" @input="emit('update:modelValue', $event.target.value)" @change="emit('change', $event.target.value)" />
      <span class="ui-field__trailing">
        <button v-if="type === 'password'" type="button" :aria-label="visible ? '隐藏密码' : '显示密码'" :aria-pressed="visible" :disabled="disabled" @click="visible = !visible"><AppIcon name="eye" :size="20" /></button>
        <button v-else-if="clearable && String(modelValue).length" type="button" aria-label="清空" :disabled="disabled" @click="clear"><AppIcon name="close" :size="18" /></button>
        <slot name="trailing" />
      </span>
    </div>
    <span v-if="error || hint" :id="`${id}-hint`" class="ui-field__hint" :role="error ? 'alert' : undefined">{{ error || hint }}</span>
  </div>
</template>
<style scoped lang="scss" src="../styles/ui/Field.scss"></style>
