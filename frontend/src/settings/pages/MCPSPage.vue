<!--
MCP 服务页包装：只负责把设置草稿的 mcp 字段接到 MCPSettings。
不读取 store，也不负责保存；新增、删除和字段修改都通过 v-model:mcp 写回 draft.mcp。
调用示例：<MCPSPage :draft="draft" />，由 SettingsPage 按登记表动态渲染。
-->
<script setup>
import MCPSettings from '../components/MCPSettings.vue'

defineProps({ draft: { type: Object, required: true } })
</script>

<template>
  <MCPSettings v-model:mcp="draft.mcp" />
</template>
