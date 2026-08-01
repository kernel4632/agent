<!--
搜索字段：使用 M3E search-bar 提供主页搜索入口和清空动作。
组件只反馈搜索文本，筛选规则继续由主页计算属性完成。
调用示例：<SearchField :model-value="query" label="搜索" @update:model-value="setSearch" />。
-->
<script setup>
import { computed, useAttrs } from 'vue'                              // 分离搜索栏布局属性和输入属性

defineOptions({ inheritAttrs: false })                               // 输入属性应传给内部 search input
defineProps({
  modelValue: { type: String, default: '' },                          // 当前搜索文本
  label: { type: String, default: '' },                               // 输入框无障碍名称和占位文案
})
const emit = defineEmits(['update:modelValue'])                       // 向主页反馈搜索意图
const attrs = useAttrs()                                               // class/style 属于 M3E 搜索栏
const inputAttrs = computed(() => { const { class: _class, style: _style, ...rest } = attrs; return rest }) // 其余属性传给真实搜索 input
</script>

<template>
  <m3e-search-bar :class="$attrs.class" :style="$attrs.style" clearable :clear-label="label" @clear="emit('update:modelValue', '')">
    <m3e-icon slot="leading" name="search"></m3e-icon>
    <input slot="input" v-bind="inputAttrs" type="search" :aria-label="label" :placeholder="label" :value="modelValue" @input="emit('update:modelValue', $event.target.value)" />
    <slot name="trailing" slot="trailing"></slot>
  </m3e-search-bar>
</template>
