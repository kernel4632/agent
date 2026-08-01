<!--
Workspace 面板：展示可见工作区并发出选择和新增意图。
组件不读取 Store，不直接执行 Workspace Command。
调用示例：<WorkspacePanel :workspaces="items" @select="selectWorkspace" />。
-->
<script setup>
import { t } from '../../i18n.js'                                      // 提供面板标题和工作区摘要文案

defineProps({
  workspaces: { type: Array, default: () => [] },                      // 搜索后仍可见的工作区
  activeWorkspaceId: { type: String, default: '' },                   // 当前高亮工作区身份
  total: { type: Number, default: 0 },                                // 搜索前工作区总数
})
defineEmits(['add', 'select'])                                         // 将新增和选择意图交回主页
</script>

<template>
  <aside class="workspace-panel">
    <header class="panel-heading">
      <div><h1>{{ t('workspace') }}</h1><span>{{ total }}</span></div>
      <m3e-icon-button class="icon-command" :aria-label="t('addWorkspace')" :title="t('addWorkspace')" @click="$emit('add')"><m3e-icon name="add"></m3e-icon></m3e-icon-button>
    </header>
    <div class="workspace-list">
      <m3e-card v-for="workspace in workspaces" :key="workspace.id" actionable :variant="activeWorkspaceId === workspace.id ? 'filled' : 'outlined'" :class="{ 'is-active': activeWorkspaceId === workspace.id }" @click="$emit('select', workspace.id)">
        <div class="workspace-card__layout">
          <m3e-avatar class="workspace-icon"><m3e-icon name="folder"></m3e-icon></m3e-avatar>
          <span><strong>{{ workspace.name }}</strong><small>{{ t('sessionCount', { count: workspace.sessions.length }) }} · {{ workspace.path }}</small></span>
          <m3e-icon name="keyboard_arrow_right"></m3e-icon>
        </div>
      </m3e-card>
      <div v-if="!workspaces.length" class="empty-state compact">{{ t('noWorkspace') }}</div>
    </div>
  </aside>
</template>
