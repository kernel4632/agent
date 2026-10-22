<!--
应用抽屉：始终从左侧覆盖滑出，不占主内容宽度；用户、工作区、会话和模型选择都放在这里。
只读取 store 并把选择写回，打开会话和新建会话交给 App.vue 统一导航。
调用示例：
<AppDrawer :open="drawerOpen" @close="drawerOpen = false" @new="openDraft" @open="openSession" @settings="openSettings" />
-->
<script setup>
import { computed, nextTick, ref } from 'vue'
import { AppIcon, Button, IconButton, avatarColor, initial } from '../ui/index.js'
import DrawerConversations from './DrawerConversations.vue'
import FavoritesDialog from './FavoritesDialog.vue'
import SessionStatsDialog from './SessionStatsDialog.vue'
import WorkspaceBar from './WorkspaceBar.vue'
import { store } from '../store.js'

defineProps({
  open: Boolean,                                        // 手机抽屉是否展开；桌面常驻时忽略
})
const emit = defineEmits(['close', 'new', 'open', 'settings'])

const conversations = ref(null)
const searchOpen = ref(false)
const sortOrder = ref('updated')
const sortMenu = ref(null)

function chooseSort(value) {
  sortOrder.value = value
  sortMenu.value?.removeAttribute('open')
}

// 搜索动作先展开搜索框，再把焦点交给它；平时列表保持 Rikka 式干净。
async function openSearch() {
  searchOpen.value = true
  await nextTick()
  conversations.value?.focusSearch()
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
  <aside class="app-drawer" :class="{ 'is-open': open }" role="region" aria-label="项目与会话">
    <div class="app-drawer__sheet">
      <header class="app-drawer__user">
        <span class="app-drawer__avatar" :style="{ background: avatarColor('la') }" aria-hidden="true">{{ initial('la') }}</span>
        <span class="app-drawer__identity"><strong>la</strong><small>欢迎回来</small></span>
        <IconButton class="app-drawer__close" label="关闭会话抽屉" @click="emit('close')"><AppIcon name="close" :size="16" /></IconButton>
      </header>

      <div class="app-drawer__actions">
        <Button variant="plain" class="drawer-action" @click="newConversation"><AppIcon name="new-chat" :size="18" /><span>新建对话</span></Button>
        <Button variant="plain" class="drawer-action" @click="openSearch"><AppIcon name="search" :size="18" /><span>搜索对话</span></Button>
      </div>

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
        ref="conversations"
        class="app-drawer__sessions"
        :workspace="workspace"
        :active-session-id="store.ui.activeSessionID"
        :show-search="searchOpen"
        :sort-order="sortOrder"
        @open="openConversation"
        @new="newConversation"
      />

      <footer class="app-drawer__footer">
        <Button variant="plain" class="assistant-picker" @click="emit('settings')">
          <span class="assistant-picker__avatar" :style="{ background: avatarColor('la') }" aria-hidden="true">{{ initial('la') }}</span>
          <span class="assistant-picker__identity">
            <strong>la</strong>
            <small>{{ store.config.activeModel || '选择模型' }}</small>
          </span>
        </Button>
        <IconButton label="设置" title="设置" @click="emit('settings')"><AppIcon name="settings" :size="18" /></IconButton>
      </footer>
      <div class="app-drawer__footer-actions">
        <button type="button" aria-label="助手管理" title="助手管理" @click="emit('settings')"><AppIcon name="assistant" :size="19" /></button>
        <button type="button" aria-label="收藏的消息" title="收藏的消息" @click="favoritesOpen = true"><AppIcon name="favorite" :size="19" /></button>
        <button type="button" aria-label="会话统计" title="会话统计" :disabled="!activeSession" @click="statsOpen = true"><AppIcon name="stats" :size="19" /></button>
        <button type="button" aria-label="打开设置" title="设置" @click="emit('settings')"><AppIcon name="settings" :size="19" /></button>
      </div>
    </div>
  </aside>

  <FavoritesDialog :open="favoritesOpen" @update:open="favoritesOpen = $event" @open-session="openConversation" />
  <SessionStatsDialog :open="statsOpen" :session="activeSession" @update:open="statsOpen = $event" />
  <div class="app-drawer__scrim" :class="{ 'is-open': open }" aria-hidden="true" @click="emit('close')"></div>
</template>

<style scoped lang="scss">
/* --- 手机：固定覆盖层，默认藏在左侧 --- */
.app-drawer {
  position: fixed;
  inset: 0 auto 0 0;
  z-index: 41;
  display: flex;
  width: min(var(--la-drawer-width), 86vw);
  height: 100%;
  transform: translateX(-100%);
  visibility: hidden;
  transition: transform .22s ease, visibility .22s;
}
.app-drawer.is-open { transform: translateX(0); visibility: visible; }
.app-drawer__sheet {
  display: flex;
  width: 100%;
  min-height: 0;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  overflow: hidden;
  border-radius: 0 16px 16px 0;
  background: var(--la-layer-01);
  box-shadow: var(--la-shadow-overlay);
}
.app-drawer__scrim {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: var(--la-scrim);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity .22s ease, visibility .22s;
}
.app-drawer__scrim.is-open { opacity: 1; visibility: visible; pointer-events: auto; }

/* --- 用户区和常用动作 --- */
.app-drawer__user { display: flex; flex: none; align-items: center; gap: 14px; padding: 8px; }
.app-drawer__avatar {
  display: grid;
  place-items: center;
  width: 50px;
  height: 50px;
  flex: 0 0 50px;
  border-radius: 50%;
  color: var(--la-on-accent);
  font: 600 18px/1 var(--la-font-mono);
}
.app-drawer__identity { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.app-drawer__identity strong { color: var(--la-text); font-size: 16px; font-weight: 500; line-height: 24px; }
.app-drawer__identity small { color: var(--la-muted); font-size: 12px; line-height: 16px; }
.app-drawer__close { margin-left: auto; }
.app-drawer__actions { display: flex; flex: none; flex-direction: column; gap: 2px; }
.drawer-action {
  display: flex;
  width: 100%;
  min-height: 44px;
  align-items: center;
  gap: 12px;
  padding: 10px 8px;
  border: 0;
  border-radius: 12px;
  background: var(--la-layer-01);
  color: var(--la-text);
  text-align: left;
  font-size: 14px;
  font-weight: 400;
  cursor: pointer;
}
.drawer-action:hover { background: var(--la-hover); color: var(--la-text); text-decoration: none; }
.drawer-action svg { flex: none; color: var(--la-muted); }
.drawer-action:hover svg { color: var(--la-secondary); }

/* --- 工作区与会话 --- */
.app-drawer__filters { display: flex; min-width: 0; flex: none; align-items: center; gap: 8px; padding: 0 4px; }
.app-drawer__filters > :first-child { min-width: 0; flex: 1; }
.drawer-sort { position: relative; flex: none; }
.drawer-sort summary {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 50%;
  background: var(--la-panel);
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
.app-drawer__sessions { min-height: 0; flex: 1; overflow: hidden; padding: 0 4px; }

/* --- 底部模型与设置 --- */
.app-drawer__footer {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
  padding: 8px 4px 2px;
  border-top: .5px solid var(--la-line);
}
.assistant-picker {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 10px;
  padding: 4px;
  border-radius: 12px;
  text-align: left;
}
.assistant-picker:hover { background: var(--la-hover); }
.assistant-picker__avatar {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  border-radius: 50%;
  color: var(--la-on-accent);
  font: 600 15px/1 var(--la-font-mono);
}
.assistant-picker__identity { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.assistant-picker__identity strong { color: var(--la-text); font-size: 14px; font-weight: 500; line-height: 18px; }
.assistant-picker__identity small { overflow: hidden; color: var(--la-muted); font-size: 11px; line-height: 16px; text-overflow: ellipsis; white-space: nowrap; }
.app-drawer__footer-actions { display: flex; flex: none; justify-content: space-around; padding: 6px 8px 2px; }
.app-drawer__footer-actions button {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: var(--la-accent-soft);
  color: var(--la-accent);
  cursor: pointer;
}
.app-drawer__footer-actions button:hover:not(:disabled) { background: var(--la-layer-02); color: var(--la-text); }
.app-drawer__footer-actions button:disabled { opacity: .4; cursor: default; }

/* --- 桌面横向：抽屉常驻，去掉遮罩和关闭按钮 --- */
/* RikkaHub uses 1100dp; desktop 1024 laptops get the permanent drawer too. */
</style>
