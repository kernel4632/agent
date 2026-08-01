<!--
侧边栏底部：收起态提供展开动作，并始终提供设置入口。
组件只渲染父级状态和发出 expand/settings 意图。
调用示例：<SidebarFooter :open="false" view="home" @expand="expand" @settings="openSettings" />。
-->
<script setup>
import { t } from '../../i18n.js'                                     // 提供展开和设置界面文案

defineProps({
  open: { type: Boolean, default: false },                            // 收起态才显示展开动作
  view: { type: String, default: 'home' },                            // 设置页显示选中反馈
})
defineEmits(['expand', 'settings'])                                   // 将底部用户动作交回应用壳
</script>

<template>
  <div v-if="!open" class="sidebar__fourth"><m3e-icon-button class="icon-command" :aria-label="t('expandSidebar')" :title="t('expandSidebar')" @click="$emit('expand')"><m3e-icon name="menu_open"></m3e-icon></m3e-icon-button></div>
  <div class="sidebar__fifth"><m3e-button :variant="view === 'settings' ? 'tonal' : 'text'" :class="{ 'is-active': view === 'settings' }" :title="t('settings')" @click="$emit('settings')"><m3e-icon slot="icon" name="settings"></m3e-icon><span v-if="open">{{ t('settings') }}</span></m3e-button></div>
</template>
