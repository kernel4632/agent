<!--
工具管理页包装：只负责把设置草稿的 tools 字段接到 ToolsSettings。
不读取 store，也不负责保存；工具开关和权限变化通过 v-model:tools 写回 draft.tools。
调用示例：<ToolsPage :draft="draft" />，由 SettingsPage 按登记表动态渲染。
-->
<script setup>
import ToolsSettings from '../../components/settings/ToolsSettings.vue'

defineProps({ draft: { type: Object, required: true } })
</script>

<template>
  <ToolsSettings v-model:tools="draft.tools" />
</template>
