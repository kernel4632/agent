<!--
应用抽屉：始终从左侧覆盖滑出，不占主内容宽度。
结构：标题栏（收藏、统计、设置）→ 新建对话 → 常驻搜索 → 工作区 → 会话列表。
模型选择只留在输入框，侧栏不再重复。
调用示例：
<AppDrawer :open="drawerOpen" @close="drawerOpen = false" @new="openDraft" @open="openSession" @settings="openSettings" />
-->
<script setup>
import { computed, ref } from 'vue'
import { KimaDrawer } from '@kernel4632/kima'
import { AppIcon, Button, Field, IconButton } from '../ui/index.js'
import DrawerConversations from './DrawerConversations.vue'
import FavoritesDialog from './FavoritesDialog.vue'
import SessionStatsDialog from './SessionStatsDialog.vue'
import WorkspaceBar from './WorkspaceBar.vue'
import { store } from '../store.js'

defineProps({
  open: Boolean,
})
const emit = defineEmits(['close', 'new', 'open', 'settings'])

const sortOrder = ref('updated')
const sortMenu = ref(null)
const search = ref('')

function chooseSort(value) {
  sortOrder.value = value
  sortMenu.value?.removeAttribute('open')
}

// 工作区选择器同时决定会话列表内容；id 失效时退回第一个。
const workspace = computed(() => store.workspaces.find(item => item.id === store.ui.activeWorkspaceID) || store.workspaces[0] || null)
const activeSession = computed(() => store.sessions[store.ui.activeSessionID] || null)
const favoritesOpen = ref(false)
const statsOpen = ref(false)

// 选中会话或新建后先交给 App 导航，再收起手机抽屉。
function openConversation(id) {
  emit('open', id)
  emit('close')
}

function newConversation() {
  emit('new')
  emit('close')
}
</script>

<template>
  <KimaDrawer
    class="app-drawer"
    :open="open"
    placement="left"
    aria-label="项目与会话"
    @update:open="value => { if (!value) emit('close') }"
  >
    <template #header>
      <div class="app-drawer__head">
        <span class="app-drawer__title">会话</span>
        <div class="app-drawer__head-actions">
          <IconButton size="small" label="收藏的消息" title="收藏的消息" @click="favoritesOpen = true"><AppIcon name="favorite" :size="20" /></IconButton>
          <IconButton v-if="activeSession" size="small" label="会话统计" title="会话统计" @click="statsOpen = true"><AppIcon name="stats" :size="20" /></IconButton>
          <IconButton size="small" label="设置" title="设置" @click="emit('settings')"><AppIcon name="settings" :size="20" /></IconButton>
        </div>
      </div>
    </template>

    <div class="app-drawer__actions">
      <Button variant="primary" class="drawer-action" @click="newConversation"><AppIcon name="new-chat" :size="20" /><span>新建对话</span></Button>
    </div>

    <Field
      v-model="search"
      class="app-drawer__search"
      type="search"
      label="搜索会话"
      placeholder="搜索会话"
    >
      <template #leading><AppIcon name="search" :size="20" /></template>
    </Field>

    <div class="app-drawer__filters">
      <WorkspaceBar :workspaces="store.workspaces" :active-id="store.ui.activeWorkspaceID" @select="store.ui.activeWorkspaceID = $event" />
      <details ref="sortMenu" class="drawer-sort">
        <summary role="button" aria-label="会话排序" title="会话排序"><AppIcon name="sort" :size="16" /></summary>
        <div class="drawer-sort__menu">
          <button type="button" :class="{ 'is-selected': sortOrder === 'updated' }" @click="chooseSort('updated')">按修改时间</button>
          <button type="button" :class="{ 'is-selected': sortOrder === 'created' }" @click="chooseSort('created')">按创建时间</button>
        </div>
      </details>
    </div>

    <DrawerConversations
      class="app-drawer__sessions"
      :workspace="workspace"
      :active-session-id="store.ui.activeSessionID"
      :query="search"
      :sort-order="sortOrder"
      @update:query="search = $event"
      @open="openConversation"
      @new="newConversation"
    />

    <FavoritesDialog :open="favoritesOpen" @update:open="favoritesOpen = $event" @open-session="openConversation" />
    <SessionStatsDialog :open="statsOpen" :session="activeSession" @update:open="statsOpen = $event" />
  </KimaDrawer>
</template>

<style scoped lang="scss">
/* KIMA 左侧抽屉：宽度、遮罩、焦点陷阱和关闭按钮都由组件负责。 */
.app-drawer { --kima-drawer-max-width: 380px; }
.app-drawer :global(.kima-drawer__heading) { flex: 1; min-width: 0; }
.app-drawer :global(.kima-drawer__body) { display: flex; flex-direction: column; overflow: hidden; }

/* --- 标题栏、常用动作和搜索 --- */
.app-drawer__head { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 12px; }
.app-drawer__title { color: var(--la-text); font-size: 18px; font-weight: 600; line-height: 26px; }
.app-drawer__head-actions { display: flex; align-items: center; gap: 2px; }
.app-drawer__actions { display: flex; flex: none; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.drawer-action {
  display: flex;
  width: 100%;
  min-height: 56px;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
  padding: 0 20px;
  font-size: 16px;
  font-weight: 500;
}
.app-drawer__search { margin-bottom: 16px; }

/* --- 工作区与会话 --- */
.app-drawer__filters { display: flex; min-width: 0; flex: none; align-items: center; gap: 8px; margin-bottom: 16px; }
.app-drawer__filters > :first-child { min-width: 0; flex: 1; }
.drawer-sort { position: relative; flex: none; }
.drawer-sort summary {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: 50%;
  background: var(--la-layer-02);
  color: var(--la-secondary);
  list-style: none;
  cursor: pointer;
}
.drawer-sort summary::-webkit-details-marker { display: none; }
.drawer-sort summary:hover { background: var(--la-layer-02); color: var(--la-text); }
.drawer-sort__menu {
  position: absolute;
  top: 38px;
  right: 0;
  z-index: 20;
  display: grid;
  width: 148px;
  padding: 6px;
  border: 1px solid var(--la-line);
  border-radius: 12px;
  background: var(--la-panel);
  box-shadow: 0 12px 30px rgba(0, 0, 0, .18);
}
.drawer-sort__menu button { padding: 8px 10px; border: 0; border-radius: 8px; background: transparent; color: var(--la-secondary); text-align: left; font-size: 13px; cursor: pointer; }
.drawer-sort__menu button:hover { background: var(--la-hover); color: var(--la-text); }
.drawer-sort__menu button.is-selected { color: var(--la-accent); }
.app-drawer__sessions { display: flex; flex: 1; min-height: 0; flex-direction: column; padding: 0; }
</style>
