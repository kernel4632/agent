<!--
应用抽屉：始终从左侧覆盖滑出，不占主内容宽度。
结构：标题栏 → 常驻搜索 → 会话列表（始终按最近修改排序）→ 底部新建对话。
模型选择、收藏和工作区选择都不放在侧栏。
调用示例：
<Sidebar :open="drawerOpen" @close="drawerOpen = false" @open="openSession" @new="openDraft" />
-->
<script setup>
import { computed, ref } from 'vue'
import { AppIcon, Button, Dialog, Field, IconButton } from '../ui/index.js'
import SessionList from './SessionList.vue'
import { Session } from '../commands/session.js'
import { store } from '../store.js'

defineProps({
  open: Boolean,
})
const emit = defineEmits(['close', 'open', 'new'])

const search = ref('')

// 当前工作区仍是会话的来源，但侧栏不再提供切换入口。
const workspace = computed(() => store.workspaces[0] || null)

// 选中会话后先交给 App 导航，再收起抽屉。
function openConversation(id) {
  emit('open', id)
  emit('close')
}

const selecting = ref(false)
const selected = ref([])
const deleteOpen = ref(false)
const deleting = ref(false)

function startSelecting() {
  selected.value = []
  selecting.value = true
}

function cancelSelecting() {
  selected.value = []
  selecting.value = false
}

async function confirmDelete() {
  if (!selected.value.length || deleting.value) return
  deleting.value = true
  try {
    const removed = await Session.removeMany(selected.value)
    if (removed) {
      cancelSelecting()
      deleteOpen.value = false
      emit('close')
    }
  } finally { deleting.value = false }
}
</script>

<template>
  <Dialog
    class="app-drawer"
    :open="open"
    placement="left"
    aria-label="项目与会话"
    @update:open="value => { if (!value) emit('close') }"
  >
    <template #header>
      <div class="app-drawer__head">
        <span class="app-drawer__title">{{ selecting ? `已选 ${selected.length} 个` : '会话' }}</span>
        <div class="app-drawer__head-actions">
          <IconButton v-if="!selecting" size="small" label="批量选择会话" title="批量选择" @click="startSelecting"><AppIcon name="list" :size="20" /></IconButton>
          <Button v-else variant="ghost" size="small" class="app-drawer__cancel" @click="cancelSelecting">取消</Button>
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

    <SessionList
      class="app-drawer__sessions"
      :workspace="workspace"
      :active-session-id="store.ui.activeSessionID"
      :query="search"
      :selecting="selecting"
      :selected="selected"
      @update:query="search = $event"
      @update:selected="selected = $event"
      @open="openConversation"
    />

    <template #footer>
      <Transition name="drawer-action" mode="out-in">
        <Button v-if="selecting" key="delete" variant="danger" class="drawer-footer" :disabled="!selected.length" @click="deleteOpen = true">
          <AppIcon name="trash" :size="20" /><span>删除 {{ selected.length }} 个会话</span>
        </Button>
        <Button v-else key="new" variant="tonal" class="drawer-footer" @click="emit('new')">
          <AppIcon name="new-chat" :size="20" /><span>新建对话</span>
        </Button>
      </Transition>
    </template>

    <Dialog :open="deleteOpen" label="删除会话" @update:open="deleteOpen = $event">
      <p class="app-drawer__confirm">删除后无法恢复，确定删除选中的 {{ selected.length }} 个会话吗？</p>
      <div class="dialog-actions">
        <Button type="button" :disabled="deleting" @click="deleteOpen = false">取消</Button>
        <Button type="button" variant="danger" :disabled="deleting" @click="confirmDelete">删除</Button>
      </div>
    </Dialog>
  </Dialog>
</template>

<style scoped lang="scss" src="../styles/components/Sidebar.scss"></style>
