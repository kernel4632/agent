<!--
应用抽屉：始终从左侧覆盖滑出，不占主内容宽度。
结构：标题栏（统计、设置）→ 常驻搜索 → 会话列表（始终按最近修改排序）。
模型选择、新建对话、收藏和工作区选择都不放在侧栏。
调用示例：
<AppDrawer :open="drawerOpen" @close="drawerOpen = false" @open="openSession" @settings="openSettings" />
-->
<script setup>
import { computed, ref } from 'vue'
import { KimaDrawer } from '@kernel4632/kima'
import { AppIcon, Button, Field, IconButton } from '../ui/index.js'
import DrawerConversations from './DrawerConversations.vue'
import SessionStatsDialog from './SessionStatsDialog.vue'
import { store } from '../store.js'

defineProps({
  open: Boolean,
})
const emit = defineEmits(['close', 'open', 'settings'])

const search = ref('')
const statsOpen = ref(false)

// 当前工作区仍是会话的来源，但侧栏不再提供切换入口。
const workspace = computed(() => store.workspaces[0] || null)
const activeSession = computed(() => store.sessions[store.ui.activeSessionID] || null)

// 选中会话后先交给 App 导航，再收起抽屉。
function openConversation(id) {
  emit('open', id)
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
          <IconButton v-if="activeSession" size="small" label="会话统计" title="会话统计" @click="statsOpen = true"><AppIcon name="stats" :size="20" /></IconButton>
        </div>
      </div>
    </template>

    <Field
      v-model="search"
      class="app-drawer__search"
      type="search"
      label="搜索会话"
      placeholder="搜索会话"
    >
      <template #leading><AppIcon name="search" :size="20" /></template>
    </Field>

    <DrawerConversations
      class="app-drawer__sessions"
      :workspace="workspace"
      :active-session-id="store.ui.activeSessionID"
      :query="search"
      @update:query="search = $event"
      @open="openConversation"
    />

    <template #footer>
      <Button variant="tonal" class="drawer-settings" @click="emit('settings')">
        <AppIcon name="settings" :size="20" /><span>设置</span>
      </Button>
    </template>

    <SessionStatsDialog :open="statsOpen" :session="activeSession" @update:open="statsOpen = $event" />
  </KimaDrawer>
</template>

<style scoped lang="scss">
/* KIMA 左侧抽屉：宽度、遮罩、焦点陷阱和关闭按钮都由组件负责。 */
.app-drawer { --kima-drawer-max-width: 380px; }
.app-drawer :global(.kima-drawer__heading) { flex: 1; min-width: 0; }
.app-drawer :global(.kima-drawer__body) { display: flex; flex-direction: column; overflow: hidden; }

/* --- 标题栏和搜索 --- */
.app-drawer__head { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 12px; }
.app-drawer__title { color: var(--la-text); font-size: 18px; font-weight: 600; line-height: 26px; }
.app-drawer__head-actions { display: flex; align-items: center; gap: 2px; }
.app-drawer__search { margin-bottom: 16px; }
.drawer-settings {
  width: 100%;
  min-height: 56px;
  justify-content: center;
  gap: 10px;
  font-size: 16px;
}

/* --- 会话列表 --- */
.app-drawer__sessions { display: flex; flex: 1; min-height: 0; flex-direction: column; padding: 0; }
</style>
