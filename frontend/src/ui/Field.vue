<!--
通用输入框：单行输入和搜索框共用，multiline 时渲染 textarea。
label 写入 aria-label，caption 是可选可见标题；leading / trailing 插槽放图标。
size="small" 用于设置面板行内的紧凑输入框（28px），默认 normal 保持 36px。
class/style 落在根节点，min/max/step/@change 等其他属性直接透传给输入控件。
调用示例：
<Field v-model="query" type="search" label="搜索会话" placeholder="搜索会话">
  <template #leading><AppIcon name="search" /></template>
</Field>
<Field v-model="limit" size="small" type="number" label="连续次数" @change="saveLimit" />
-->
<script setup>
import { computed, useAttrs } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  modelValue: { type: [String, Number], default: '' }, // 输入内容，配合 v-model 使用
  type: { type: String, default: 'text' },             // 单行输入的类型，例如 search
  placeholder: { type: String, default: '' },
  label: { type: String, default: '' },                // 屏幕阅读器读到的名称（aria-label）
  caption: { type: String, default: '' },              // 可选的可见标题
  disabled: Boolean,
  multiline: Boolean,                                  // 为 true 时渲染 textarea
  rows: { type: [Number, String], default: undefined },
  size: { type: String, default: 'normal' },           // normal 36px，small 28px 紧凑输入框
})

const emit = defineEmits(['update:modelValue'])
const attrs = useAttrs()

// class/style 留给根节点（搜索框要靠 class 变成整块底色），其余属性交给真正的输入控件。
const rootAttrs = computed(() => ({ class: attrs.class, style: attrs.style }))
const inputAttrs = computed(() => {
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
      <textarea
        v-if="multiline"
        v-bind="inputAttrs"
        class="field ui-field__input ui-field__input--multiline"
        :value="modelValue"
        :rows="rows || undefined"
        :placeholder="placeholder"
        :aria-label="label || undefined"
        :disabled="disabled"
        @input="emit('update:modelValue', $event.target.value)"
      />
      <input
        v-else
        v-bind="inputAttrs"
        class="field ui-field__input"
        :type="type"
        :value="modelValue"
        :placeholder="placeholder"
        :aria-label="label || undefined"
        :disabled="disabled"
        @input="emit('update:modelValue', $event.target.value)"
      />
      <span v-if="$slots.trailing" class="ui-field__trailing"><slot name="trailing" /></span>
    </span>
  </label>
</template>

<style scoped lang="scss">
.ui-field { width: 100%; min-width: 0; }
.ui-field--labeled { display: grid; gap: 8px; }
.ui-field__caption { color: var(--la-secondary); font-size: 13px; font-weight: 440; line-height: 20px; }
.ui-field__control { display: flex; width: 100%; min-width: 0; align-items: center; gap: 8px; }
.ui-field__leading, .ui-field__trailing { display: inline-flex; flex: none; align-items: center; color: var(--la-muted); }
.ui-field__input { width: 100%; min-width: 0; }
.ui-field__input--multiline { height: auto; min-height: 72px; padding: 8px 10px; resize: vertical; }
/* 设置面板行内的紧凑输入框：28px、面板底色、细边框，和原来的原生数字框一致。 */
.ui-field--small .ui-field__input {
  height: 28px;
  padding: 0 7px;
  border: .5px solid var(--la-line);
  border-radius: 4px;
  background: var(--la-panel);
  color: var(--la-text);
  font-size: 12px;
}
</style>
