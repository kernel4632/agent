<!--
应用抽屉：手机从左侧滑出，桌面常驻；用户、工作区、会话和模型选择都放在这里。
只读取 store 并把选择写回，打开会话和新建会话交给 App.vue 统一导航。
调用示例：
<AppDrawer :open="drawerOpen" @close="drawerOpen = false" @new="openDraft" @open="openSession" @settings="openSettings" />
-->
<script setup>
import { computed, nextTick, ref } from 'vue'
import { AppIcon, Button, IconButton, Select, avatarColor, initial } from '../ui/index.js'
import DrawerConversations from './DrawerConversations.vue'
import WorkspaceBar from './WorkspaceBar.vue'
import { store } from '../store.js'

defineProps({
  open: Boolean,                                        // 手机抽屉是否展开；桌面常驻时忽略
})
const emit = defineEmits(['close', 'new', 'open', 'settings'])

const conversations = ref(null)
const searchOpen = ref(false)

// 搜索动作先展开搜索框，再把焦点交给它；平时列表保持 Rikka 式干净。
async function openSearch() {
  searchOpen.value = true
  await nextTick()
  conversations.value?.focusSearch()
}

// 工作区选择器同时决定会话列表内容；id 失效时退回第一个。
const workspace = computed(() => store.workspaces.find(item => item.id === store.ui.activeWorkspaceID) || store.workspaces[0] || null)

// 底部模型选择只列已启用的供应商，值仍是 [供应商, 模型] 的 JSON 字符串。
const models = computed(() => Object.entries(store.config.providers || {}).flatMap(([provider, entry]) => {
  if (!entry.enabled) return []
  return (entry.models || []).map(model => ({ provider, model }))
}))
const modelOptions = computed(() => models.value.map(item => ({
  value: JSON.stringify([item.provider, item.model]),
  label: `${item.provider} / ${item.model}`,
})))
const modelSelection = computed(() => JSON.stringify([store.config.activeProvider, store.config.activeModel]))

function chooseModel(value) {
  if (!value) return
  const [provider, model] = JSON.parse(value)
  store.config.activeProvider = provider
  store.config.activeModel = model
}

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

      <WorkspaceBar :workspaces="store.workspaces" :active-id="store.ui.activeWorkspaceID" @select="store.ui.activeWorkspaceID = $event" />

      <DrawerConversations
        ref="conversations"
        class="app-drawer__sessions"
        :workspace="workspace"
        :active-session-id="store.ui.activeSessionID"
        :show-search="searchOpen"
        @open="openConversation"
        @new="newConversation"
      />

      <footer class="app-drawer__footer">
        <Select
          class="app-drawer__model"
          size="small"
          label="选择模型"
          :model-value="modelSelection"
          :options="modelOptions"
          :disabled="!models.length"
          @update:model-value="chooseModel"
        />
        <IconButton label="设置" title="设置" @click="emit('settings')"><AppIcon name="settings" :size="16" /></IconButton>
      </footer>
    </div>
  </aside>

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
  border-radius: 18px;
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
.app-drawer__model { min-width: 0; flex: 1; }
.app-drawer__model :deep(.ui-select__input) {
  width: 100%;
  height: 32px;
  padding: 0 8px;
  overflow: hidden;
  border-radius: 999px;
  background: transparent;
  color: var(--la-secondary);
  text-overflow: ellipsis;
}
.app-drawer__model :deep(.ui-select__input:hover) { background: var(--la-hover); color: var(--la-text); }

/* --- 桌面横向：抽屉常驻，去掉遮罩和关闭按钮 --- */
/* RikkaHub uses 1100dp; desktop 1024 laptops get the permanent drawer too. */
@media (min-width: 1100px) and (orientation: landscape) {
  .app-drawer {
    position: relative;
    inset: auto;
    z-index: 1;
    width: var(--la-drawer-width);
    flex: 0 0 var(--la-drawer-width);
    transform: none;
    visibility: visible;
    transition: none;
  }
  .app-drawer__sheet { border-radius: 16px; }
  .app-drawer__close { display: none; }
  .app-drawer__scrim { display: none; }
}
</style>
