<!--
通用下拉框：把原生 select 包成统一接口，保留键盘操作和浏览器自带的弹出列表。
label 写入 aria-label，caption 是可选可见标题；small 用于列表行内的紧凑选择。
class/style 落在根节点，selectClass 追加到内部 select，供必须直接定位原生控件的既有选择器使用。
调用示例：<Select v-model="permission" :options="permissionOptions" label="文件读取权限" />
          <Select v-model="transport" :options="transportOptions" caption="传输方式" />
-->
<script setup>
import { computed, useAttrs } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },  // 当前选中的值，配合 v-model 使用
  options: { type: Array, default: () => [] },          // 每项 { value, label, disabled }
  label: { type: String, default: '' },                 // 屏幕阅读器读到的名称（aria-label）
  caption: { type: String, default: '' },               // 可选的可见标题
  disabled: Boolean,
  size: { type: String, default: 'normal' },            // normal 36px，small 28px 无边框
  selectClass: { type: String, default: '' },            // 追加到内部 select 的 class，供既有选择器直接定位原生控件
})

const emit = defineEmits(['update:modelValue'])
const attrs = useAttrs()

// class/style 留给根节点，方便调用方控制宽度；aria-* 等其他属性交给真正的 select。
const rootAttrs = computed(() => ({ class: attrs.class, style: attrs.style }))
const selectAttrs = computed(() => {
  const rest = { ...attrs }
  delete rest.class
  delete rest.style
  return rest
})

// 原生 select 的值一律是字符串，交给上层自己按需要转换。
function onChange(event) {
  emit('update:modelValue', event.target.value)
}
</script>

<template>
  <label
    v-bind="rootAttrs"
    class="ui-select"
    :class="{ 'ui-select--labeled': caption, 'ui-select--small': size === 'small' }"
  >
    <span v-if="caption" class="ui-select__caption">{{ caption }}</span>
    <select
      v-bind="selectAttrs"
      :class="['field', 'ui-select__input', selectClass]"
      :value="modelValue"
      :aria-label="label || undefined"
      :disabled="disabled"
      @change="onChange"
    >
      <option v-for="option in options" :key="option.value" :value="option.value" :disabled="option.disabled">
        {{ option.label }}
      </option>
    </select>
  </label>
</template>

<style scoped lang="scss">
.ui-select { display: block; min-width: 0; }
.ui-select--labeled { display: grid; gap: 8px; }
.ui-select__caption { color: var(--la-secondary); font-size: 13px; font-weight: 440; line-height: 20px; }
.ui-select__input { width: 100%; cursor: pointer; }

/* 列表行内的紧凑尺寸：28px、无边框，和原来的工具权限下拉一致。 */
.ui-select--small .ui-select__input {
  width: auto;
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 4px;
  background: var(--la-layer-02);
  color: var(--la-text);
  font-size: 13px;
  cursor: pointer;
}
.ui-select--small .ui-select__input:focus-visible { outline: 2px solid var(--la-accent-border); outline-offset: 2px; }
</style>
