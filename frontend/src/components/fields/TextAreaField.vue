<!--
长文本字段：组合 M3E form-field 和 textarea-autosize，承载多行业务文本。
组件只同步文本，不保存设置，不触发 API。
调用示例：<TextAreaField v-model="draft.prompt" label="全局提示词" :min-rows="10" />。
-->
<script setup>
import { computed, ref, useAttrs, useId } from 'vue'                  // 分离字段布局属性和原生文本框属性

defineOptions({ inheritAttrs: false })                               // 外部属性应落到 textarea
defineProps({
  modelValue: { type: String, default: '' },                          // 当前多行文本
  label: { type: String, default: '' },                               // 输入框浮动标签
  minRows: { type: Number, default: 1 },                              // 初始最少可见行数
  maxRows: { type: Number, default: 0 },                              // 自动增长上限，0 表示不限制
})
const emit = defineEmits(['update:modelValue', 'keydown'])            // 向业务组件反馈文本和键盘意图
const attrs = useAttrs()                                               // class/style 属于 M3E 宿主，其余属于 textarea
const inputAttrs = computed(() => { const { class: _class, style: _style, ...rest } = attrs; return rest }) // 避免布局类重复落到 textarea
const fieldID = useId()                                               // 连接三个原生与自定义元素
const inputElement = ref(null)                                        // 发送消息后需要恢复键盘焦点
defineExpose({ focus: () => inputElement.value?.focus() })             // 只开放连续输入所需动作
</script>

<template>
  <m3e-form-field :class="$attrs.class" :style="$attrs.style">
    <label slot="label" :for="fieldID">{{ label }}</label>
    <textarea :id="fieldID" ref="inputElement" v-bind="inputAttrs" :value="modelValue" @input="emit('update:modelValue', $event.target.value)" @keydown="emit('keydown', $event)"></textarea>
  </m3e-form-field>
  <m3e-textarea-autosize :for="fieldID" :min-rows="minRows" :max-rows="maxRows"></m3e-textarea-autosize>
</template>
