<!--
高级设置页包装：只负责把设置草稿的 rules、modeDefinitions、diagnostics、snapshot 接到 AdvancedSettings。
不读取 store，也不负责保存；四个字段都通过现有 v-model 写回 draft。
调用示例：<AdvancedPage :draft="draft" />，由 SettingsPage 按登记表动态渲染。
-->
<script setup>
import AdvancedSettings from '../components/AdvancedSettings.vue'

defineProps({ draft: { type: Object, required: true } })
</script>

<template>
  <AdvancedSettings
    v-model:rules="draft.rules"
    v-model:modes="draft.modeDefinitions"
    v-model:diagnostics="draft.diagnostics"
    v-model:snapshot="draft.snapshot"
  />
</template>
