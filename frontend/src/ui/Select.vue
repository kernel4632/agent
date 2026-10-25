<!--
通用下拉框：保留 native select 的键盘操作和浏览器弹出列表，但外观按 KIMA 输入控件绘制。
label 写入 aria-label，caption 是可见标题；size="small" 只用于列表行内的紧凑选择。
class/style 落在根节点，selectClass 追加到内部 select，供必须直接定位原生控件的既有选择器使用。
调用示例：<Select v-model="permission" :options="permissionOptions" label="文件读取权限" />
          <Select v-model="transport" :options="transportOptions" caption="传输方式" />
-->
<script setup>
import { computed, useAttrs } from 'vue'
import AppIcon from './AppIcon.vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },  // 当前选中的值，配合 v-model 使用
  options: { type: Array, default: () => [] },          // 每项 { value, label, disabled }
  label: { type: String, default: '' },                 // 屏幕阅读器读到的名称（aria-label）
  caption: { type: String, default: '' },               // 可选的可见标题
  disabled: Boolean,
  size: { type: String, default: 'normal' },            // normal 64px，small 40px
  selectClass: { type: String, default: '' },           // 追加到内部 select 的 class
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
    <span class="ui-select__control">
      <select
        v-bind="selectAttrs"
        :class="['ui-select__input', selectClass]"
        :value="modelValue"
        :aria-label="label || undefined"
        :disabled="disabled"
        @change="onChange"
      >
        <option v-for="option in options" :key="option.value" :value="option.value" :disabled="option.disabled">
          {{ option.label }}
        </option>
      </select>
      <AppIcon name="down" :size="size === 'small' ? 16 : 20" class="ui-select__chevron" aria-hidden="true" />
    </span>
  </label>
</template>

<style scoped lang="scss">
.ui-select { display: block; min-width: 0; }
.ui-select--labeled { display: grid; gap: 8px; }
.ui-select__caption {
  color: var(--kima-color-on-surface-variant);
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
}
.ui-select__control { position: relative; display: flex; min-width: 0; align-items: center; }
.ui-select__input {
  width: 100%;
  height: var(--kima-field-height, 64px);
  padding: 0 calc(var(--kima-field-padding, 20px) + 28px) 0 var(--kima-field-padding, 20px);
  border: 0;
  border-radius: var(--kima-radius-m, 12px);
  appearance: none;
  background: var(--kima-color-layer-2);
  color: var(--kima-color-on-surface);
  font-family: var(--kima-font-family);
  font-size: var(--kima-font-size-body-large, 18px);
  line-height: 1.4;
  text-overflow: ellipsis;
  cursor: pointer;
  transition: background-color .16s ease, box-shadow .16s ease;
}
.ui-select__input:hover:not(:disabled) { background: var(--kima-color-layer-3); }
.ui-select__input:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 var(--kima-outline-width-focused, 2px) var(--kima-color-primary);
}
.ui-select__input:disabled { opacity: var(--kima-opacity-disabled, .38); cursor: not-allowed; }
.ui-select__chevron {
  position: absolute;
  right: var(--kima-field-padding, 20px);
  color: var(--kima-color-on-surface-variant);
  pointer-events: none;
}

/* 列表行内的紧凑尺寸：和同一个操作区里的图标按钮保持同一档。 */
.ui-select--small .ui-select__control { width: 100%; }
.ui-select--small .ui-select__input {
  width: 100%;
  height: 40px;
  padding: 0 32px 0 12px;
  border-radius: var(--kima-radius-s, 8px);
  font-size: var(--kima-font-size-body-small, 14px);
}
.ui-select--small .ui-select__chevron { right: 10px; }
</style>
