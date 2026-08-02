<!--
已打开会话目录：在展开侧边栏中展示本次运行中已经加载的 Session。
组件不排序、不加载会话，只渲染父级准备好的打开顺序并反馈打开或关闭意图。
调用示例：<SidebarSessionList :sessions="openedSessions" @open="openSession" @close="closeSession" />。
-->
<script setup>
import { t } from '../../i18n.js'                                     // 提供无标题会话的替代文案

defineProps({
  sessions: { type: Array, default: () => [] },                       // 已从 Server 加载并按打开顺序排列的 Session
  activeId: { type: String, default: '' },                            // 当前对话页 Session 身份
  view: { type: String, default: 'home' },                            // 当前页面决定是否显示选中态
})
defineEmits(['open', 'close'])                                        // 将打开和关闭意图交回应用壳
</script>

<template>
  <section class="sidebar__third">
    <!-- 侧边栏第三排只显示会话标题，点击后由应用壳切换页面。 -->
    <div class="sidebar__sessions">
      <div v-for="session in sessions" :key="session.id" class="sidebar-session-item" :class="{ 'is-active': view === 'chat' && activeId === session.id }">
        <m3e-button :variant="view === 'chat' && activeId === session.id ? 'tonal' : 'text'" :title="session.title || t('unnamedSession')" @click="$emit('open', session.id)"></m3e-button>
        <span>{{ session.title || t('unnamedSession') }}</span>
        <m3e-icon-button class="sidebar-session-close" :aria-label="`关闭 ${session.title || t('unnamedSession')}`" :title="`关闭 ${session.title || t('unnamedSession')}`" @click.stop="$emit('close', session.id)"><m3e-icon name="close"></m3e-icon></m3e-icon-button>
      </div>
    </div>
  </section>
</template>
