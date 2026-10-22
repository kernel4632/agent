<!--
抽屉会话列：搜索、按日期分组的会话、更多菜单和重命名/删除弹窗都在这里。
放在 app/AppDrawer.vue 的会话区内，桌面和手机的抽屉共用这一份逻辑。
调用示例：<DrawerConversations :workspace="workspace" :active-session-id="id" :show-search="searchOpen" @open="openSession" @new="openDraft" />
-->
<script setup>
import { computed, ref } from 'vue'
import { AppIcon, Button, Dialog, Field } from '../ui/index.js'
import { Session } from '../commands/session.js'

const props = defineProps({
  workspace: { type: Object, default: null },
  activeSessionId: String,
  showSearch: Boolean,                                  // 只有点抽屉“搜索对话”后才显示搜索框
  sortOrder: { type: String, default: 'updated' },      // updated 按修改时间，created 按创建时间
})
const emit = defineEmits(['open', 'new'])

// --- 搜索 ---
const search = ref('')
const searchField = ref(null)
const sessions = computed(() => props.workspace?.sessions || [])
const stampOf = item => Number(props.sortOrder === 'created' ? item.createdAt : item.updatedAt || item.createdAt) || 0
const visible = computed(() => {
  const query = search.value.trim().toLowerCase()
  return sessions.value
    .filter(item => !query || (item.title || '').toLowerCase().includes(query))
    .slice()
    .sort((first, second) => stampOf(second) - stampOf(first))
})

// 按最后更新时间分成今天、昨天、更早；时间戳缺失时归到更早。
const groups = computed(() => {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const startOfYesterday = new Date(startOfToday)
  startOfYesterday.setDate(startOfYesterday.getDate() - 1)
  const buckets = [
    { key: 'today', label: '今天', items: [] },
    { key: 'yesterday', label: '昨天', items: [] },
    { key: 'earlier', label: '更早', items: [] },
  ]
  for (const item of visible.value) {
    const stamp = stampOf(item)
    if (stamp >= startOfToday.getTime()) buckets[0].items.push(item)
    else if (stamp >= startOfYesterday.getTime()) buckets[1].items.push(item)
    else buckets[2].items.push(item)
  }
  return buckets.filter(group => group.items.length)
})

// 抽屉动作行的“搜索对话”把焦点交给这里的搜索框。
defineExpose({ focusSearch: () => searchField.value?.focus() })

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
    <Field v-if="showSearch" ref="searchField" v-model="search" class="home-search" type="search" label="搜索会话" placeholder="搜索对话">
      <template #leading><AppIcon name="search" :size="16" /></template>
    </Field>

    <nav class="home-sessions__list" aria-label="会话列表">
      <template v-if="groups.length">
        <section v-for="group in groups" :key="group.key" class="home-sessions__group">
          <h2 class="group-label">{{ group.label }}</h2>
          <ul class="home-sessions__items">
            <li v-for="item in group.items" :key="item.id" class="home-session" :class="{ 'is-active': item.id === activeSessionId }">
              <!-- 会话主按钮只换外壳；更多菜单仍是 details/summary。 -->
              <Button variant="plain" class="home-session__main" @click="emit('open', item.id)">
                <span class="home-session__title">{{ item.title || '新会话' }}</span>
              </Button>
              <details class="home-session__menu">
                <summary :aria-label="`${item.title || '新会话'} 的更多操作`"><AppIcon name="more" :size="15" /></summary>
                <div class="home-session__menu-pop">
                  <Button variant="ghost" @click.prevent="openRename(item)">重命名</Button>
                  <Button variant="ghost" @click.prevent="openDelete(item)">删除</Button>
                </div>
              </details>
            </li>
          </ul>
        </section>
      </template>
      <div v-else class="home-empty">
        <strong>{{ search ? '没有找到匹配的会话' : '还没有会话' }}</strong>
        <p>{{ search ? '换个关键词试试。' : '新建一个会话，开始和 la 一起工作。' }}</p>
        <Button v-if="!search" @click="emit('new')"><AppIcon name="edit" :size="14" />新建会话</Button>
        <Button v-else variant="ghost" @click="search = ''">清除搜索</Button>
      </div>
    </nav>

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
.home-sessions { display: flex; min-height: 0; flex: 1; flex-direction: column; }
.home-search {
  display: flex;
  height: 36px;
  min-width: 0;
  flex: none;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 0 12px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--la-layer-02) 60%, transparent);
  color: var(--la-muted);
}
.home-search:focus-within { background: var(--la-layer-02); }
.home-search :deep(input) { width: 100%; min-width: 0; height: auto; padding: 0; border: 0; outline: 0; background: transparent; color: var(--la-text); font-size: 13px; }
.home-search :deep(input::placeholder) { color: var(--la-muted); }
.home-search :deep(input:focus) { box-shadow: none; }
.home-sessions__list { display: flex; min-height: 0; flex: 1; flex-direction: column; overflow-y: auto; padding-right: 4px; }
.home-sessions__group { display: flex; flex-direction: column; gap: 8px; }
.home-sessions__items { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
.group-label { display: flex; height: 32px; flex: none; align-items: center; margin: 0; padding: 0 12px; border-radius: 8px; background: var(--la-panel); color: var(--la-accent); font-size: 12px; font-weight: 700; letter-spacing: .02em; }
.home-session { display: flex; min-height: 36px; flex: none; align-items: center; border-radius: 999px; }
.home-session:hover { background: var(--la-hover); }
.home-session.is-active { background: var(--la-layer-02); }
.home-session__main {
  display: flex;
  height: 100%;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 9px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--la-secondary);
  text-align: left;
  cursor: pointer;
}
.home-session__title { min-width: 0; flex: 1; overflow: hidden; color: var(--la-text); font-size: 14px; font-weight: 400; text-overflow: ellipsis; white-space: nowrap; }
.home-session__menu { position: relative; flex: none; margin-right: 4px; }
.home-session__menu summary {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
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
  border-radius: 12px;
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
.home-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 40px 16px; text-align: center; }
.home-empty strong { color: var(--la-text); font-size: 13px; font-weight: 530; }
.home-empty p { max-width: 360px; margin: 0 0 8px; color: var(--la-muted); font-size: 13px; font-weight: 440; line-height: 20px; }
@media (max-width: 1023px) {
  .home-sessions { padding-top: 0; }
}
@media (max-width: 767px) {
  .home-sessions { padding-top: 4px; }
  .home-session { height: 48px; }
  .home-session__menu summary { opacity: 1; }
}
</style>
