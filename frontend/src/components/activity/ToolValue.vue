<!--
工具参数/结果的通用值视图：不认工具名，递归展示对象和数组。
多行字符串按真实换行显示；带 fenced code 的内容交给 Markdown，代码块等语法可以正常渲染。
调用示例：<ToolValue :value="tool.input" />。
-->
<script setup>
import { computed } from 'vue'
import Markdown from '../../ui/Markdown.vue'

const props = defineProps({
  value: { type: null, default: null },
  depth: { type: Number, default: 0 },
  plain: Boolean, // 工具结果是纯文本时不再包一层 JSON 引号
})

const isArray = computed(() => Array.isArray(props.value))
const isObject = computed(() => props.value !== null && typeof props.value === 'object' && !isArray.value)
const isString = computed(() => typeof props.value === 'string')
const text = computed(() => isString.value ? props.value : '')
const multiline = computed(() => text.value.includes('\n'))
// 只把明确带 fenced code 的内容当 Markdown；普通代码/命令保持原文，避免被 Markdown 改写。
const markdown = computed(() => multiline.value && /(^|\n)\s*(```|~~~)/.test(text.value))
const lineCount = computed(() => text.value ? text.value.split('\n').length : 0)
const scalar = computed(() => props.value === null ? 'null' : (props.plain && isString.value ? props.value : JSON.stringify(props.value)))
</script>

<template>
  <div class="tool-value" :class="{ 'tool-value--nested': depth > 0 }">
    <template v-if="isObject">
      <div v-if="!Object.keys(value).length" class="tool-value__empty">{}</div>
      <template v-else>
        <div v-for="(item, key) in value" :key="key" class="tool-value__row">
          <span class="tool-value__key">{{ key }}</span>
          <ToolValue :value="item" :depth="depth + 1" />
        </div>
      </template>
    </template>

    <template v-else-if="isArray">
      <div v-if="!value.length" class="tool-value__empty">[]</div>
      <template v-else>
        <div v-for="(item, index) in value" :key="index" class="tool-value__row">
          <span class="tool-value__key">[{{ index }}]</span>
          <ToolValue :value="item" :depth="depth + 1" />
        </div>
      </template>
    </template>

    <template v-else-if="isString && multiline">
      <div class="tool-value__meta">{{ lineCount }} 行</div>
      <div v-if="markdown" class="tool-value__markdown">
        <Markdown :content="value" compact />
      </div>
      <pre v-else class="tool-value__text">{{ value }}</pre>
    </template>

    <code v-else class="tool-value__scalar">{{ scalar }}</code>
  </div>
</template>

<style scoped lang="scss" src="../../styles/components/activity/ToolValue.scss"></style>
