<!--
首页会话列：搜索、最近会话、更多菜单和重命名/删除弹窗都在这里。
调用示例：<SessionList :workspace="workspace" :active-session-id="id" @open="openSession" @new="openDraft" />
-->
<script setup>
import { computed, ref } from 'vue'
import AppIcon from '../ui/AppIcon.vue'
import Button from '../ui/Button.vue'
import Dialog from '../ui/Dialog.vue'
import Field from '../ui/Field.vue'
import { avatarColor, initial } from '../ui/avatar.js'
import { Session } from '../commands/session.js'

const props = defineProps({
  workspace: { type: Object, default: null },
  activeSessionId: String,
})
const emit = defineEmits(['open', 'new'])

// --- 搜索 ---
const search = ref('')
const sessions = computed(() => props.workspace?.sessions || [])
const visible = computed(() => {
  const query = search.value.trim().toLowerCase()
  return sessions.value.filter(item => !query || (item.title || '').toLowerCase().includes(query))
})

// --- 重命名 / 删除 ---
const dialogOpen = ref(false)
const dialogMode = ref('rename')
const target = ref(null)
const value = ref('')
const busy = ref(false)

// 菜单和弹窗都是原生 details / dialog，打开新菜单前先收起旧菜单。
function closeMenus() {
  document.querySelectorAll('.home-session__menu[open]').forEach(item => item.removeAttribute('open'))
}

function openRename(session) {
  closeMenus()
  dialogMode.value = 'rename'
  target.value = session
  value.value = session.title || ''
  dialogOpen.value = true
}

function openDelete(session) {
  closeMenus()
  dialogMode.value = 'delete'
  target.value = session
  value.value = ''
  dialogOpen.value = true
}

// 弹窗关闭由父组件确认：请求进行中忽略 Esc 和取消按钮。
function setDialogOpen(open) {
  if (!open && busy.value) return
  dialogOpen.value = open
}

async function submitDialog() {
  if (busy.value || !target.value) return
  busy.value = true
  try {
    const ok = dialogMode.value === 'rename'
      ? await Session.rename(target.value.id, value.value)
      : await Session.remove(target.value.id)
    if (ok) dialogOpen.value = false
  } finally { busy.value = false }
}
</script>

<template>
  <div class="home-sessions">
    <div class="home-sessions__top">
      <Field v-model="search" class="home-search" type="search" label="搜索会话" placeholder="搜索会话">
        <template #leading><AppIcon name="search" :size="15" /></template>
      </Field>
      <Button v-if="sessions.length" variant="ghost" class="home-new" @click="emit('new')"><AppIcon name="edit" :size="14" />新建会话</Button>
    </div>

    <div class="home-sessions__list">
      <template v-if="visible.length">
        <div class="group-label">最近会话</div>
        <div v-for="item in visible" :key="item.id" class="home-session" :class="{ 'is-active': item.id === activeSessionId }">
          <!-- 会话主按钮只换外壳；更多菜单仍是 details/summary。 -->
          <Button variant="plain" class="home-session__main" @click="emit('open', item.id)">
            <span class="home-session__avatar" :style="{ background: avatarColor(workspace?.id) }">{{ initial(item.title) }}</span>
            <span class="home-session__title">{{ item.title || '新会话' }}</span>
            <span class="home-session__project">{{ workspace?.name }}</span>
          </Button>
          <details class="home-session__menu">
            <summary :aria-label="`${item.title || '新会话'} 的更多操作`"><AppIcon name="more" :size="15" /></summary>
            <div class="home-session__menu-pop">
              <Button variant="ghost" @click.prevent="openRename(item)">重命名</Button>
              <Button variant="ghost" @click.prevent="openDelete(item)">删除</Button>
            </div>
          </details>
        </div>
      </template>
      <div v-else class="home-empty">
        <strong>{{ search ? '没有找到匹配的会话' : '还没有会话' }}</strong>
        <p>{{ search ? '换个关键词试试。' : '新建一个会话，开始和 la 一起工作。' }}</p>
        <Button v-if="!search" @click="emit('new')"><AppIcon name="edit" :size="14" />新建会话</Button>
        <Button v-else variant="ghost" @click="search = ''">清除搜索</Button>
      </div>
    </div>

    <Dialog :open="dialogOpen" :label="dialogMode === 'rename' ? '重命名会话' : '删除会话'" @update:open="setDialogOpen">
      <form @submit.prevent="submitDialog">
        <h2>{{ dialogMode === 'rename' ? '重命名会话' : '删除这段对话？' }}</h2>
        <p>{{ dialogMode === 'rename' ? '给这段对话起一个容易记住的名字。' : '会话和历史记录将从服务器永久删除，无法恢复。' }}</p>
        <Field v-if="dialogMode === 'rename'" v-model="value" caption="会话名称" label="会话名称" required maxlength="120" />
        <div class="dialog-actions">
          <Button type="button" :disabled="busy" @click="setDialogOpen(false)">取消</Button>
          <Button type="submit" :variant="dialogMode === 'delete' ? 'danger' : 'default'" :disabled="busy">{{ dialogMode === 'rename' ? '保存名称' : '确认删除' }}</Button>
        </div>
      </form>
    </Dialog>
  </div>
</template>

<style scoped lang="scss">
.home-sessions { display: flex; min-height: 0; flex-direction: column; }
.home-sessions__top { display: flex; flex: none; align-items: center; gap: 8px; margin-bottom: 8px; }
.home-search {
  display: flex;
  height: 36px;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--la-layer-02) 60%, transparent);
  color: var(--la-muted);
}
.home-search:focus-within { background: var(--la-layer-02); }
.home-search :deep(input) { width: 100%; min-width: 0; height: auto; padding: 0; border: 0; outline: 0; background: transparent; color: var(--la-text); font-size: 13px; }
.home-search :deep(input::placeholder) { color: var(--la-muted); }
.home-search :deep(input:focus) { box-shadow: none; }
.home-new {
  display: flex;
  height: 28px;
  flex: none;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--la-secondary);
  font-size: 13px;
  font-weight: 530;
  cursor: pointer;
}
.home-new:hover { background: var(--la-hover); color: var(--la-text); text-decoration: none; }
.home-sessions__list { display: flex; min-height: 0; flex: 1; flex-direction: column; gap: 1px; overflow-y: auto; padding-right: 4px; }
.group-label { display: flex; height: 28px; flex: none; align-items: center; padding: 0 6px; color: var(--la-muted); font-size: 13px; font-weight: 440; }
.home-session { display: flex; height: 40px; flex: none; align-items: center; border-radius: 6px; }
.home-session:hover, .home-session.is-active { background: var(--la-layer-01); }
.home-session__main {
  display: flex;
  height: 100%;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border: 0;
  background: transparent;
  color: var(--la-secondary);
  text-align: left;
  cursor: pointer;
}
.home-session__avatar {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  border-radius: 3px;
  color: #fff;
  font: 600 8px/1 var(--la-font-mono);
}
.home-session__title { min-width: 0; overflow: hidden; color: var(--la-text); font-size: 13px; font-weight: 530; text-overflow: ellipsis; white-space: nowrap; }
.home-session__project { margin-left: auto; color: var(--la-muted); font-size: 13px; font-weight: 440; white-space: nowrap; opacity: 0; transition: opacity .12s ease; }
.home-session:hover .home-session__project, .home-session.is-active .home-session__project { opacity: 1; }
.home-session__menu { position: relative; flex: none; margin-right: 4px; }
.home-session__menu summary {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  color: var(--la-muted);
  cursor: pointer;
  opacity: 0;
  list-style: none;
}
.home-session:hover .home-session__menu summary,
.home-session.is-active .home-session__menu summary,
.home-session__menu[open] summary { opacity: 1; }
.home-session__menu summary::-webkit-details-marker { display: none; }
.home-session__menu summary:hover { background: var(--la-hover); color: var(--la-text); }
.home-session__menu-pop {
  position: absolute;
  top: 26px;
  right: 0;
  z-index: 20;
  width: 140px;
  padding: 4px;
  border-radius: 6px;
  background: var(--la-layer-01);
  box-shadow: var(--la-shadow-floating);
}
.home-session__menu-pop button {
  display: block;
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--la-text);
  text-align: left;
  font-size: 13px;
  font-weight: 400;
  cursor: pointer;
}
.home-session__menu-pop button:hover { background: var(--la-hover); text-decoration: none; }
.home-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 52px 16px; text-align: center; }
.home-empty strong { color: var(--la-text); font-size: 13px; font-weight: 530; }
.home-empty p { max-width: 360px; margin: 0 0 8px; color: var(--la-muted); font-size: 13px; font-weight: 440; line-height: 20px; }
@media (max-width: 1023px) {
  .home-sessions { padding-top: 0; }
}
@media (max-width: 767px) {
  .home-sessions { padding-top: 4px; }
  .home-session__project { display: none; }
  .home-session { height: 48px; }
  .home-session__menu summary { opacity: 1; }
}
</style>
