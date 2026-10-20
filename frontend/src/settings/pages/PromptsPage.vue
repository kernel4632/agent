<!--
系统提示词页包装：只负责把设置草稿的 prompt 字段接到 PromptsSettings。
不读取 store，也不负责保存；文本变化通过 v-model:prompt 写回 draft.prompt。
调用示例：<PromptsPage :draft="draft" />，由 SettingsPage 按登记表动态渲染。
-->
<script setup>
import PromptsSettings from '../../components/settings/PromptsSettings.vue'

defineProps({ draft: { type: Object, required: true } })
</script>

<template>
  <PromptsSettings v-model:prompt="draft.prompt" />
</template>
