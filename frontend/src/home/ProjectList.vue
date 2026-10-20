<!--
首页项目列：桌面显示项目列表，窄屏换成工作区下拉框；底部保留设置和帮助入口。
调用示例：<ProjectList :workspaces="workspaces" :workspace="workspace" @select="choose" @settings="openSettings" />
-->
<script setup>
import { computed } from 'vue'
import AppIcon from '../ui/AppIcon.vue'
import Button from '../ui/Button.vue'
import IconButton from '../ui/IconButton.vue'
import Select from '../ui/Select.vue'
import { avatarColor, initial } from '../ui/avatar.js'
import { UI } from '../commands/ui.js'

const props = defineProps({
  workspaces: { type: Array, default: () => [] },
  workspace: { type: Object, default: null },
})
const emit = defineEmits(['select', 'settings'])

// 窄屏下拉使用统一 Select，名称缺失时和工作区列表一样退回路径。
const workspaceOptions = computed(() => props.workspaces.map(item => ({ value: item.id, label: item.name || item.path })))
</script>

<template>
  <div class="home-mobile-project">
    <span class="project-avatar" :style="{ background: avatarColor(workspace?.id) }">{{ initial(workspace?.name) }}</span>
    <Select
      class="home-mobile-project__select"
      label="选择项目"
      :model-value="workspace?.id"
      :options="workspaceOptions"
      @update:model-value="emit('select', $event)"
    />
  </div>

  <aside class="home-projects" aria-label="项目">
    <header class="home-projects__head">
      <span>项目</span>
      <IconButton label="管理工作区" title="管理工作区" @click="emit('settings')"><AppIcon name="plus" :size="15" /></IconButton>
    </header>
    <div class="home-projects__list">
      <Button v-for="item in workspaces" :key="item.id" variant="plain" class="project-row" :class="{ 'is-active': item.id === workspace?.id }" @click="emit('select', item.id)">
        <span class="project-avatar" :style="{ background: avatarColor(item.id) }">{{ initial(item.name) }}</span>
        <span class="project-row__name">{{ item.name || item.path }}</span>
      </Button>
      <p v-if="!workspaces.length" class="home-projects__empty">还没有工作区</p>
    </div>
    <div class="home-projects__bottom">
      <Button variant="plain" class="project-row" @click="emit('settings')"><AppIcon name="settings" :size="15" /><span class="project-row__name">设置</span></Button>
      <Button variant="plain" class="project-row" @click="UI.notify('帮助文档暂未接入')"><AppIcon name="info" :size="15" /><span class="project-row__name">帮助</span></Button>
    </div>
  </aside>
</template>

<style scoped lang="scss">
.home-projects { display: flex; min-height: 0; flex-direction: column; }
.home-projects__head {
  display: flex;
  height: 28px;
  flex: none;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px 0 6px;
  color: var(--la-muted);
  font-size: 13px;
  font-weight: 530;
}
.home-projects__list { display: flex; min-height: 0; flex-direction: column; gap: 4px; overflow-y: auto; }
.home-projects__empty { margin: 8px 6px; color: var(--la-muted); font-size: 13px; }
.project-row {
  display: flex;
  width: 100%;
  height: 28px;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--la-secondary);
  text-align: left;
  font-size: 13px;
  font-weight: 440;
  cursor: pointer;
}
.project-row:hover { background: var(--la-layer-01); color: var(--la-text); }
.project-row.is-active { background: var(--la-layer-03); color: var(--la-text); }
.project-row__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.project-avatar {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  border-radius: 3px;
  color: #fff;
  font: 600 8px/1 var(--la-font-mono);
}
.home-projects__bottom { display: flex; flex-direction: column; gap: 2px; margin-top: auto; padding-top: 16px; }
.home-mobile-project { display: none; }
@media (max-width: 1023px) {
  .home-projects { display: none; }
  .home-mobile-project {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 6px;
    border-radius: 6px;
    background: var(--la-layer-01);
  }
  .home-mobile-project__select { flex: 1; min-width: 0; }
  /* 覆盖统一下拉的 36px 输入框外观，保持原来透明、无边框的行内样式。 */
  .home-mobile-project :deep(.ui-select__input) {
    width: 100%;
    min-width: 0;
    height: auto;
    padding: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--la-text);
    font-size: 13px;
  }
  .home-mobile-project :deep(.ui-select__input:focus) { box-shadow: none; }
}
</style>
