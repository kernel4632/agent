<!--
抽屉会话列：搜索、按日期分组的会话、更多菜单和重命名/删除弹窗都在这里。
放在 app/AppDrawer.vue 的会话区内，桌面和手机的抽屉共用这一份逻辑。
调用示例：<DrawerConversations :workspace="workspace" :active-session-id="id" :query="search" @open="openSession" />
-->
<script setup>
import { computed, ref } from 'vue'
import { KimaCheckbox, KimaList } from '@kernel4632/kima'
import { Button, Dialog, Field, MenuButton } from '../ui/index.js'
import { Session } from '../commands/session.js'

const MENU_ITEMS = [
  { value: 'rename', label: '重命名' },
  { value: 'delete', label: '删除' },
]

const props = defineProps({
  workspace: { type: Object, default: null },
  activeSessionId: String,
  query: { type: String, default: '' },                 // 搜索框在 AppDrawer，列表只负责过滤
  selecting: Boolean,                                  // 批量选择模式
  selected: { type: Array, default: () => [] },        // 已选会话 id
})
const emit = defineEmits(['open', 'update:query', 'update:selected'])

const isSelected = id => props.selected.includes(id)
function toggleSelected(session) {
  const next = isSelected(session.id)
    ? props.selected.filter(id => id !== session.id)
    : [...props.selected, session.id]
  emit('update:selected', next)
}

// --- 搜索 ---
const sessions = computed(() => props.workspace?.sessions || [])
const stampOf = item => Number(item.updatedAt || item.createdAt) || 0
const visible = computed(() => {
  const query = props.query.trim().toLowerCase()
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

// --- 重命名 / 删除 ---
const dialogOpen = ref(false)
const dialogMode = ref('rename')
const target = ref(null)
const value = ref('')
const busy = ref(false)

// 会话行的 KIMA 菜单只返回动作名，具体弹窗仍由这里管理。
function onMenuSelect(session, action) {
  if (action === 'rename') openRename(session)
  else if (action === 'delete') openDelete(session)
}

function openRename(session) {
  dialogMode.value = 'rename'
  target.value = session
  value.value = session.title || ''
  dialogOpen.value = true
}

function openDelete(session) {
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
    <nav class="home-sessions__list" aria-label="会话列表">
      <template v-if="groups.length">
        <section v-for="group in groups" :key="group.key" class="home-sessions__group">
          <h2 class="group-label">{{ group.label }}</h2>
          <KimaList class="session-list" :items="group.items" :label="group.label">
            <template #item="{ item }">
              <div class="home-session" :class="{ 'is-active': item.id === activeSessionId, 'is-selected': isSelected(item.id) }">
                <Transition name="session-check">
                  <KimaCheckbox
                    v-if="selecting"
                    class="home-session__check"
                    :model-value="isSelected(item.id)"
                    :aria-label="`选择 ${item.title || '新会话'}`"
                    @update:model-value="toggleSelected(item)"
                  />
                </Transition>
                <Button variant="plain" class="home-session__main" @click="selecting ? toggleSelected(item) : emit('open', item.id)">
                  <span class="home-session__title">{{ item.title || '新会话' }}</span>
                </Button>
                <MenuButton
                  v-if="!selecting"
                  class="home-session__menu"
                  :label="`${item.title || '新会话'} 的更多操作`"
                  :items="MENU_ITEMS"
                  @select="onMenuSelect(item, $event)"
                />
              </div>
            </template>
          </KimaList>
        </section>
      </template>
      <div v-else class="home-empty">
        <strong>{{ query ? '没有找到匹配的会话' : '还没有会话' }}</strong>
        <p>{{ query ? '换个关键词试试。' : '点右上角的新建按钮开始。' }}</p>
        <Button v-if="query" variant="ghost" @click="emit('update:query', '')">清除搜索</Button>
      </div>
    </nav>

    <Dialog :open="dialogOpen" :label="dialogMode === 'rename' ? '重命名会话' : '删除会话'" @update:open="setDialogOpen">
      <form @submit.prevent="submitDialog">
        <p v-if="dialogMode === 'delete'">会话和历史记录将从服务器永久删除，无法恢复。</p>
        <Field v-if="dialogMode === 'rename'" v-model="value" label="会话标题" placeholder="输入会话标题" required maxlength="120" />
        <div class="dialog-actions">
          <Button type="button" :disabled="busy" @click="setDialogOpen(false)">取消</Button>
          <Button type="submit" :disabled="busy">{{ dialogMode === 'rename' ? '保存' : '删除' }}</Button>
        </div>
      </form>
    </Dialog>
  </div>
</template>

<style scoped lang="scss">
.home-sessions { display: flex; min-height: 0; flex: 1; flex-direction: column; }
.home-sessions__list { display: flex; min-height: 0; flex: 1; flex-direction: column; overflow-y: auto; }
.home-sessions__group { display: flex; flex-direction: column; gap: 6px; }
.session-list { display: grid; gap: 2px; }
/* KIMA 0.7.1 的 KimaList 行带 20px 内边距和底色，没有 plain 导航行变体；
   这里把行容器还原成透明，选中/hover 由内部 .home-session 负责。等 KIMA 增加 plain 行后删除。 */
:global(.session-list .kima-list__item) {
  display: flex;
  min-height: 48px;
  padding: 0;
  border-radius: 12px;
  background: transparent;
}
.group-label { display: flex; height: 30px; flex: none; align-items: center; margin: 0; padding: 0 12px; border-radius: 8px; background: transparent; color: var(--la-muted); font-size: 13px; font-weight: 600; letter-spacing: 0; }
.home-session { display: flex; width: 100%; min-height: 48px; flex: none; align-items: center; border-radius: 12px; }
.home-session:hover { background: var(--la-hover); }
.home-session.is-active { background: var(--la-layer-02); }
.home-session.is-selected { background: var(--la-accent-soft); }
.home-session__check { flex: none; margin-left: 8px; }
.session-check-enter-active, .session-check-leave-active { transition: opacity var(--kima-duration-fast) var(--kima-curve-standard), transform var(--kima-duration-medium) var(--kima-curve-standard); }
.session-check-enter-from, .session-check-leave-to { opacity: 0; transform: scale(.8); }
.home-session__main {
  display: flex;
  height: 100%;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 9px;
  padding: 0 12px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--la-secondary);
  text-align: left;
  cursor: pointer;
}
.home-session__title { min-width: 0; flex: 1; overflow: hidden; color: var(--la-text); font-size: 15px; font-weight: 400; text-overflow: ellipsis; white-space: nowrap; }
.home-session__menu { flex: none; margin-right: 4px; opacity: .6; transition: opacity .12s ease; }
.home-session:hover .home-session__menu,
.home-session.is-active .home-session__menu,
.home-session__menu:focus-within { opacity: 1; }
.home-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 48px 16px; text-align: center; }
.home-empty strong { color: var(--la-text); font-size: 15px; font-weight: 600; line-height: 22px; }
.home-empty p { max-width: 320px; margin: 0 0 8px; color: var(--la-muted); font-size: 14px; font-weight: 400; line-height: 22px; }
@media (max-width: 1023px) {
  .home-sessions { padding-top: 0; }
}
@media (max-width: 767px) {
  .home-sessions { padding-top: 4px; }
  .home-session { height: 48px; }
  .home-session__menu summary { opacity: 1; }
}
</style>
