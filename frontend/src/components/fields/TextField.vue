<!--
文本字段：把 Vue 双向值转换为 M3E 官方 form-field 与原生 input 组合。
组件只传递输入意图，不读取 Store，不判断业务规则。
调用示例：<TextField v-model="provider.name" label="供应商名" />。
-->
<script setup>
import { computed, ref, useAttrs, useId } from 'vue'                  // 分离字段布局属性和原生输入属性

defineOptions({ inheritAttrs: false })                               // 将外部属性交给真实输入而不是外层字段
defineProps({
  modelValue: { type: [String, Number], default: '' },                // 当前业务字段值
  label: { type: String, default: '' },                               // 输入框浮动标签
  type: { type: String, default: 'text' },                            // 浏览器输入类型
})
const emit = defineEmits(['update:modelValue', 'blur', 'keydown'])    // 向业务组件反馈输入和键盘意图
const attrs = useAttrs()                                               // class/style 属于 M3E 宿主，其余属于原生输入
const inputAttrs = computed(() => { const { class: _class, style: _style, ...rest } = attrs; return rest }) // 避免布局类重复落到 input
const fieldID = useId()                                               // 同一页面多字段不会产生重复 id
const inputElement = ref(null)                                        // 向标题编辑等父组件开放聚焦能力
defineExpose({ focus: () => inputElement.value?.focus(), select: () => inputElement.value?.select() }) // 只暴露连续输入需要的原生动作
</script>

<template>
  <m3e-form-field :class="$attrs.class" :style="$attrs.style">
    <label slot="label" :for="fieldID">{{ label }}</label>
    <input :id="fieldID" ref="inputElement" v-bind="inputAttrs" :type="type" :value="modelValue" @input="emit('update:modelValue', $event.target.value)" @blur="emit('blur', $event)" @keydown="emit('keydown', $event)" />
  </m3e-form-field>
</template>
