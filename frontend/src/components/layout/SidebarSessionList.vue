<!--
最近会话目录：在展开侧边栏中展示可直接切换的 Session。
组件不排序、不加载会话，只渲染父级准备好的摘要并反馈点击身份。
调用示例：<RecentSessions :sessions="recentSessions" :active-id="sessionID" @open="openSession" />。
-->
<script setup>
import { t } from '../../i18n.js'                                     // 提供会话目录标题

defineProps({
  sessions: { type: Array, default: () => [] },                       // 已排序且限制数量的 Session 摘要
  activeId: { type: String, default: '' },                            // 当前对话页 Session 身份
  view: { type: String, default: 'home' },                            // 当前页面决定是否显示选中态
})
defineEmits(['open'])                                                 // 将 Session 身份交回应用壳
</script>

<template>
  <section class="sidebar__third">
    <div class="sidebar__label"><span>{{ t('sessions') }}</span><small>{{ sessions.length }}</small></div>
    <div class="sidebar__sessions">
      <m3e-button v-for="session in sessions" :key="session.id" :variant="view === 'chat' && activeId === session.id ? 'tonal' : 'text'" :class="{ 'is-active': view === 'chat' && activeId === session.id }" :title="session.title || t('unnamedSession')" @click="$emit('open', session.id)"><m3e-circular-progress-indicator v-if="session.status === 'running'" slot="icon" variant="wavy" indeterminate aria-label="正在运行"></m3e-circular-progress-indicator>{{ session.title || t('unnamedSession') }}</m3e-button>
    </div>
  </section>
</template>
