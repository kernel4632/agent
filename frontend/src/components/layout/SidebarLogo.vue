<!--
侧边栏顶部：显示产品身份，并在展开态提供收起动作。
组件只发出 home 和 collapse 意图，不读取全局页面状态。
调用示例：<SidebarHeader :open="sidebarOpen" @home="openHome" @collapse="collapse" />。
-->
<script setup>
import { t } from '../../i18n.js'                                     // 提供产品入口和收起动作的界面文案

defineProps({ open: { type: Boolean, default: false } })              // 当前侧边栏是否展开
defineEmits(['home', 'collapse'])                                     // 将顶部用户动作交回应用壳
</script>

<template>
  <div class="sidebar__first">
    <m3e-icon-button class="product-logo" :aria-label="t('agentHome')" title="Agent" @click="$emit('home')"><m3e-avatar>A</m3e-avatar></m3e-icon-button>
    <m3e-icon-button v-if="open" class="icon-command" :aria-label="t('collapseSidebar')" :title="t('collapseSidebar')" @click="$emit('collapse')"><m3e-icon name="keyboard_double_arrow_left"></m3e-icon></m3e-icon-button>
  </div>
</template>
