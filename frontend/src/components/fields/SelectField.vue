<!--
选择字段：把业务选项映射为 M3E form-field、select 和 option。
组件只回传选中值，权限、语言或模型的修改仍由上层 Command 完成。
调用示例：<SelectField v-model="tool.permission" :options="permissions" label="权限" />。
-->
<script setup>
import { useId } from 'vue'                                           // 为标签和选择器建立无障碍关联

defineProps({
  modelValue: { type: [String, Array], default: '' },                 // 当前选中值
  label: { type: String, default: '' },                               // 选择器浮动标签
  options: { type: Array, default: () => [] },                        // { value, label, disabled } 选项目录
  disabled: { type: Boolean, default: false },                        // 运行期间等场景禁止切换
})
const emit = defineEmits(['update:modelValue', 'change'])             // 同时支持 v-model 和显式业务反馈
const fieldID = useId()                                               // 同一页面多个选择器保持独立


// --- 反馈选中值 ---
function selectValue(event) {
  const value = event.target.value                                    // 读取 M3E select 提交的业务值
  emit('update:modelValue', value)                                    // 更新父组件绑定草稿
  emit('change', value)                                               // 允许父组件继续触发 Command
}
</script>

<template>
  <m3e-form-field>
    <label slot="label" :for="fieldID">{{ label }}</label>
    <m3e-select :id="fieldID" :value="modelValue" :disabled="disabled" @change="selectValue">
      <m3e-option v-for="option in options" :key="option.value" :value="option.value" :disabled="option.disabled">{{ option.label }}</m3e-option>
    </m3e-select>
  </m3e-form-field>
</template>
