<!--
  工作区胶囊栏：当前项目用工作区代替 RikkaHub 的文件夹模型。
  只负责显示和选择，不读取会话数据。
-->
<script setup>
import { AppIcon, Button } from '../ui/index.js'

defineProps({
  workspaces: { type: Array, default: () => [] },
  activeID: { type: String, default: '' },
})
const emit = defineEmits(['select'])
</script>

<template>
  <div class="folder-bar" role="tablist" aria-label="工作区">
    <Button
      v-for="item in workspaces"
      :key="item.id"
      variant="plain"
      class="folder-chip"
      :class="{ 'is-selected': item.id === activeID }"
      role="tab"
      :aria-selected="item.id === activeID"
      @click="emit('select', item.id)"
    >
      <AppIcon name="folder" :size="14" />
      <span>{{ item.name || item.path }}</span>
    </Button>
  </div>
</template>

<style scoped lang="scss">
.folder-bar { display: flex; gap: 8px; overflow-x: auto; padding: 0 4px; scrollbar-width: none; }
.folder-bar::-webkit-scrollbar { display: none; }
.folder-chip {
  display: inline-flex;
  min-height: 28px;
  flex: none;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: 0;
  border-radius: 999px;
  background: var(--la-panel);
  color: var(--la-secondary);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.folder-chip.is-selected { background: var(--la-accent-soft); color: var(--la-accent); }
.folder-chip:hover { background: var(--la-layer-02); color: var(--la-text); }
</style>
