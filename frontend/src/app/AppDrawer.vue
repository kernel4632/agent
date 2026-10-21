<!--
应用抽屉：手机从左侧滑出，桌面常驻；用户、工作区、会话和模型选择都放在这里。
只读取 store 并把选择写回，打开会话和新建会话交给 App.vue 统一导航。
调用示例：
<AppDrawer :open="drawerOpen" @close="drawerOpen = false" @new="openDraft" @open="openSession" @settings="openSettings" />
-->
<script setup>
import { computed, nextTick, ref } from 'vue'
import AppIcon from '../ui/AppIcon.vue'
import Button from '../ui/Button.vue'
import IconButton from '../ui/IconButton.vue'
import Select from '../ui/Select.vue'
import DrawerConversations from './DrawerConversations.vue'
import { avatarColor, initial } from '../ui/avatar.js'
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
const workspaceOptions = computed(() => store.workspaces.map(item => ({ value: item.id, label: item.name || item.path })))

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

function chooseWorkspace(id) {
  store.ui.activeWorkspaceID = id
}

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
  <aside class="home-panel app-drawer" :class="{ 'is-open': open }" role="region" aria-label="项目与会话">
    <div class="app-drawer__sheet">
      <header class="app-drawer__user">
        <span class="app-drawer__avatar" :style="{ background: avatarColor('la') }" aria-hidden="true">{{ initial('la') }}</span>
        <span class="app-drawer__identity"><strong>la</strong><small>欢迎回来</small></span>
        <IconButton class="app-drawer__close" label="关闭会话抽屉" @click="emit('close')"><AppIcon name="close" :size="16" /></IconButton>
      </header>

      <div class="app-drawer__actions">
        <Button variant="plain" class="drawer-action" @click="newConversation"><AppIcon name="plus" :size="18" /><span>新建对话</span></Button>
        <Button variant="plain" class="drawer-action" @click="openSearch"><AppIcon name="search" :size="18" /><span>搜索对话</span></Button>
      </div>

      <div class="app-drawer__workspace-row">
        <span class="app-drawer__workspace-avatar" :style="{ background: avatarColor(workspace?.id) }" aria-hidden="true">{{ initial(workspace?.name || '本地工作区') }}</span>
        <Select
          class="app-drawer__workspace"
          label="选择项目"
          :model-value="store.ui.activeWorkspaceID"
          :options="workspaceOptions"
          @update:model-value="chooseWorkspace"
        />
      </div>

      <div class="app-drawer__sessions">
        <DrawerConversations
          ref="conversations"
          :workspace="workspace"
          :active-session-id="store.ui.activeSessionID"
          :show-search="searchOpen"
          @open="openConversation"
          @new="newConversation"
        />
      </div>

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
.app-drawer__user { display: flex; flex: none; align-items: center; gap: 10px; padding: 4px 4px 0; }
.app-drawer__avatar {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  border-radius: 12px;
  color: #fff;
  font: 600 14px/1 var(--la-font-mono);
}
.app-drawer__identity { display: flex; min-width: 0; flex-direction: column; gap: 1px; }
.app-drawer__identity strong { color: var(--la-text); font-size: 14px; font-weight: 650; line-height: 18px; }
.app-drawer__identity small { color: var(--la-muted); font-size: 12px; line-height: 16px; }
.app-drawer__close { margin-left: auto; }
.app-drawer__actions { display: flex; flex: none; flex-direction: column; gap: 2px; }
.drawer-action {
  display: flex;
  width: 100%;
  height: 36px;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--la-secondary);
  text-align: left;
  font-size: 13px;
  font-weight: 530;
  cursor: pointer;
}
.drawer-action:hover { background: var(--la-hover); color: var(--la-text); text-decoration: none; }
.drawer-action svg { flex: none; color: var(--la-muted); }
.drawer-action:hover svg { color: var(--la-secondary); }

/* --- 工作区与会话 --- */
.app-drawer__workspace-row {
  display: flex;
  height: 36px;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-radius: 999px;
}
.app-drawer__workspace-row:hover { background: var(--la-hover); }
.app-drawer__workspace-avatar {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  border-radius: 6px;
  color: #fff;
  font: 600 9px/1 var(--la-font-mono);
}
.app-drawer__workspace { min-width: 0; flex: 1; }
.app-drawer__workspace :deep(.ui-select__input) {
  width: 100%;
  height: 36px;
  padding: 0 18px 0 0;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--la-secondary);
  font-size: 13px;
  font-weight: 530;
  text-overflow: ellipsis;
  cursor: pointer;
}
.app-drawer__workspace :deep(.ui-select__input:hover) { color: var(--la-text); }
.app-drawer__workspace :deep(.ui-select__input:focus) { box-shadow: none; }
.app-drawer__sessions { display: flex; min-height: 0; flex: 1; flex-direction: column; overflow: hidden; padding: 0 4px; }
.app-drawer__sessions :deep(.home-sessions) { min-height: 0; flex: 1; }

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
@media (min-width: 1000px) and (orientation: landscape) {
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
