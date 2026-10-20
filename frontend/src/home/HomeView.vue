<!--
首页视图：计算当前工作区，用两列布局组合项目列和会话列。
调用示例：<HomeView :workspaces="store.workspaces" :active-workspace-id="id" :active-session-id="sessionId" @open="openSession" @new="openDraft" />
-->
<script setup>
import { computed } from 'vue'
import ProjectList from './ProjectList.vue'
import SessionList from './SessionList.vue'

const props = defineProps({
  workspaces: { type: Array, default: () => [] },
  activeWorkspaceId: String,
  activeSessionId: String,
})
const emit = defineEmits(['open', 'new', 'select-workspace', 'settings'])

// 选中的工作区同时决定项目列高亮和会话列内容；id 失效时退回第一个。
const workspace = computed(() => props.workspaces.find(item => item.id === props.activeWorkspaceId) || props.workspaces[0])
</script>

<template>
  <section class="home-panel" aria-label="项目与会话">
    <div class="home-grid">
      <ProjectList
        :workspaces="workspaces"
        :workspace="workspace"
        @select="emit('select-workspace', $event)"
        @settings="emit('settings')"
      />
      <SessionList
        :workspace="workspace"
        :active-session-id="activeSessionId"
        @open="emit('open', $event)"
        @new="emit('new')"
      />
    </div>
  </section>
</template>

<style scoped lang="scss">
.home-panel { display: flex; flex-direction: column; min-height: 0; }
.home-grid {
  display: grid;
  width: 100%;
  max-width: 1080px;
  height: 100%;
  min-height: 0;
  grid-template-columns: 280px minmax(0, 720px);
  gap: 32px;
  margin: 0 auto;
  padding: 24px 24px 48px;
}
@media (max-width: 1023px) {
  .home-grid { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); align-content: start; gap: 8px; padding: 16px 16px 32px; }
}
@media (max-width: 767px) {
  .home-grid { padding: 12px; }
}
</style>
