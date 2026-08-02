<!--
Workspace 面板：展示可见工作区并发出选择和新增意图。
组件不读取 Store，不直接执行 Workspace Command。
调用示例：<WorkspacePanel :workspaces="items" @select="selectWorkspace" />。
-->
<script setup>
import { t } from '../../i18n.js'                                      // 提供面板标题和按钮文案

defineProps({
  workspaces: { type: Array, default: () => [] },                      // 搜索后仍可见的工作区
  activeWorkspaceId: { type: String, default: '' },                   // 当前高亮工作区身份
})
defineEmits(['add', 'select'])                                         // 将新增和选择意图交回主页
</script>

<template>
  <aside class="workspace-panel">
    <header class="panel-heading">
      <h1>{{ t('workspace') }}</h1>
      <m3e-icon-button class="icon-command" :aria-label="t('addWorkspace')" :title="t('addWorkspace')" @click="$emit('add')"><m3e-icon name="add"></m3e-icon></m3e-icon-button>
    </header>
    <div class="workspace-list">
      <m3e-card v-for="workspace in workspaces" :key="workspace.id" actionable :variant="activeWorkspaceId === workspace.id ? 'filled' : 'outlined'" :class="{ 'is-active': activeWorkspaceId === workspace.id }" @click="$emit('select', workspace.id)">
        <div class="workspace-card__layout"><strong>{{ workspace.name }}</strong></div>
      </m3e-card>
    </div>
  </aside>
</template>
