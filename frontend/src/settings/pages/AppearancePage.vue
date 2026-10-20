<!--
通用设置页包装：只负责把设置草稿的 appearance 字段接到 AppearanceSettings。
不读取 store，也不负责保存；外观变更直接写回 draft.appearance，由设置页底部统一保存。
调用示例：<AppearancePage :draft="draft" />，由 SettingsPage 按登记表动态渲染。
-->
<script setup>
import AppearanceSettings from '../components/AppearanceSettings.vue'

defineProps({ draft: { type: Object, required: true } })
</script>

<template>
  <AppearanceSettings :appearance="draft.appearance" @change="draft.appearance[$event.field] = $event.value" />
</template>
