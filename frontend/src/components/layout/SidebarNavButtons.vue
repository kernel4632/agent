<!--
侧边栏主目的地：提供主页和新建对话两个固定入口。
组件根据父级传入页面状态显示选中反馈，点击只发出业务意图。
调用示例：<SidebarDestinations view="home" :open="true" @home="openHome" @create="createSession" />。
-->
<script setup>
import { t } from '../../i18n.js'                                     // 提供主导航可见文案

defineProps({
  open: { type: Boolean, default: false },                            // 展开态显示目的地文字
  view: { type: String, default: 'home' },                            // 当前页面用于选中反馈
})
defineEmits(['home', 'create'])                                       // 将主页和新建意图交回应用壳
</script>

<template>
  <nav class="sidebar__second" :aria-label="t('mainNav')">
    <div class="sidebar-nav-item" :class="{ 'is-active': view === 'home' }">
      <m3e-button :variant="view === 'home' ? 'tonal' : 'text'" :title="t('home')" @click="$emit('home')"></m3e-button>
      <m3e-icon name="search"></m3e-icon><span v-if="open">搜索</span>
    </div>
    <div class="sidebar-nav-item">
      <m3e-button variant="text" :title="t('newChat')" @click="$emit('create')"></m3e-button>
      <m3e-icon name="edit_square"></m3e-icon><span v-if="open">{{ t('newChat') }}</span>
    </div>
  </nav>
</template>
