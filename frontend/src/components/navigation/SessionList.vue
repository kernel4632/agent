<!--
抽屉会话列：搜索、自定义分组、拖拽编排、更多菜单和重命名/删除弹窗都在这里。
放在 app/Sidebar.vue 的会话区内，桌面和手机的抽屉共用这一份逻辑。
调用示例：<SessionList :sessions="sessions" :active-session-id="id" :query="search" @open="openSession" />。
-->
<script setup>
import { computed, onMounted, ref } from 'vue'
import Checkbox from '../../ui/Checkbox.vue'
import Button from '../../ui/Button.vue'
import Dialog from '../../ui/Dialog.vue'
import Field from '../../ui/Field.vue'
import Menu from '../../ui/Menu.vue'
import { Session } from "../../features/session.js"
import { AgentAPI } from '../../utils/api.js'
import { Notice } from "../../utils/notice.js"

const MENU_ITEMS = [
  { value: 'rename', label: '重命名' },
  { value: 'delete', label: '删除' },
]

const props = defineProps({
  sessions: { type: Array, default: () => [] },
  activeSessionId: String,
  query: { type: String, default: '' },                 // 搜索框在 Sidebar，列表只负责过滤
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
const stampOf = item => Number(item.updatedAt || item.createdAt) || 0
const visible = computed(() => {
  const query = props.query.trim().toLowerCase()
  return props.sessions
    .filter(item => !query || (item.title || '').toLowerCase().includes(query))
    .slice()
    .sort((first, second) => stampOf(second) - stampOf(first))
})

// --- 自定义分组；没有分组时保留原来的日期分组 ---
const customGroups = ref([])
const groupsReady = ref(false)
const dragging = ref(null)

const dateGroups = computed(() => {
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

const sections = computed(() => {
  if (!customGroups.value.length) return dateGroups.value
  const byId = new Map(visible.value.map(item => [item.id, item]))
  const assigned = new Set()
  const result = []
  for (const group of customGroups.value) {
    const items = group.sessions.map(id => byId.get(id)).filter(Boolean)
    group.sessions.forEach(id => assigned.add(id))
    if (items.length || !props.query.trim()) {
      result.push({ key: `group:${group.id}`, id: group.id, label: group.name, items, custom: true })
    }
  }
  const ungrouped = visible.value.filter(item => !assigned.has(item.id))
  if (ungrouped.length) result.push({ key: 'ungrouped', id: '', label: '未分组', items: ungrouped, custom: false })
  return result
})

async function loadGroups() {
  try {
    const data = await AgentAPI.getSessionGroups()
    customGroups.value = Array.isArray(data.groups) ? data.groups.map(group => ({
      ...group,
      sessions: Array.isArray(group.sessions) ? group.sessions : [],
    })) : []
  } catch (error) {
    Notice.show(error.message)
  } finally {
    groupsReady.value = true
  }
}

async function persistGroups() {
  try {
    const data = await AgentAPI.saveSessionGroups(customGroups.value)
    customGroups.value = data.groups
  } catch (error) {
    Notice.show(error.message)
    await loadGroups()
  }
}

function groupOf(sessionId) {
  return customGroups.value.find(group => group.sessions.includes(sessionId))
}

function removeSessionFromGroups(sessionId) {
  for (const group of customGroups.value) group.sessions = group.sessions.filter(id => id !== sessionId)
}

async function moveSession(sessionId, groupId, beforeSessionId = '') {
  removeSessionFromGroups(sessionId)
  if (groupId) {
    const group = customGroups.value.find(item => item.id === groupId)
    if (!group) return
    const index = beforeSessionId ? group.sessions.indexOf(beforeSessionId) : -1
    if (index >= 0) group.sessions.splice(index, 0, sessionId)
    else group.sessions.push(sessionId)
  }
  await persistGroups()
}

async function moveSessionWithin(sessionId, direction) {
  const group = groupOf(sessionId)
  if (!group) return
  const index = group.sessions.indexOf(sessionId)
  const next = index + direction
  if (index < 0 || next < 0 || next >= group.sessions.length) return
  ;[group.sessions[index], group.sessions[next]] = [group.sessions[next], group.sessions[index]]
  await persistGroups()
}

async function moveGroup(groupId, direction) {
  const index = customGroups.value.findIndex(group => group.id === groupId)
  const next = index + direction
  if (index < 0 || next < 0 || next >= customGroups.value.length) return
  ;[customGroups.value[index], customGroups.value[next]] = [customGroups.value[next], customGroups.value[index]]
  await persistGroups()
}

function groupMenu(group, index) {
  return [
    { value: 'rename-group', label: '重命名分组' },
    { value: 'group-up', label: '分组上移', disabled: index === 0 },
    { value: 'group-down', label: '分组下移', disabled: index === customGroups.value.length - 1 },
    { value: 'delete-group', label: '删除分组' },
  ]
}

function sessionMenu(session) {
  const group = groupOf(session.id)
  const items = MENU_ITEMS.map(item => ({ ...item }))
  if (group) {
    const index = group.sessions.indexOf(session.id)
    items.push({ value: 'session-up', label: '会话上移', disabled: index === 0 })
    items.push({ value: 'session-down', label: '会话下移', disabled: index === group.sessions.length - 1 })
    items.push({ value: 'ungroup', label: '移到未分组' })
  }
  for (const target of customGroups.value) {
    if (target.id === group?.id) continue
    items.push({ value: `move:${target.id}`, label: `移到「${target.name}」` })
  }
  return items
}

function onMenuSelect(session, action) {
  if (action === 'rename') openRename(session)
  else if (action === 'delete') openDelete(session)
  else if (action === 'session-up') void moveSessionWithin(session.id, -1)
  else if (action === 'session-down') void moveSessionWithin(session.id, 1)
  else if (action === 'ungroup') void moveSession(session.id, '')
  else if (action.startsWith('move:')) void moveSession(session.id, action.slice(5))
}

// --- 鼠标拖拽：组头可以排序和接收会话，会话可以跨组移动 ---
function startDrag(event, kind, id, groupId = '') {
  if (props.selecting) return
  dragging.value = { kind, id, groupId }
  event.dataTransfer?.setData('text/plain', JSON.stringify(dragging.value))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

async function dropOnGroup(event, groupId) {
  event.preventDefault()
  const payload = dragging.value
  dragging.value = null
  if (!payload) return
  if (payload.kind === 'group') {
    const from = customGroups.value.findIndex(group => group.id === payload.id)
    const to = customGroups.value.findIndex(group => group.id === groupId)
    if (from < 0 || to < 0 || from === to) return
    const [group] = customGroups.value.splice(from, 1)
    customGroups.value.splice(to, 0, group)
    await persistGroups()
    return
  }
  if (payload.kind === 'session') await moveSession(payload.id, groupId)
}

async function dropOnSession(event, groupId, beforeSessionId) {
  event.preventDefault()
  event.stopPropagation()
  const payload = dragging.value
  dragging.value = null
  if (payload?.kind === 'session') await moveSession(payload.id, groupId, beforeSessionId)
}

function endDrag() {
  dragging.value = null
}

// --- 会话重命名 / 删除 ---
const dialogOpen = ref(false)
const dialogMode = ref('rename')
const target = ref(null)
const value = ref('')
const busy = ref(false)

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

function setDialogOpen(open) {
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

// --- 分组重命名 / 删除 ---
const groupDialogOpen = ref(false)
const groupDialogMode = ref('create')
const groupTarget = ref(null)
const groupName = ref('')
const groupBusy = ref(false)

function openCreateGroup() {
  groupDialogMode.value = 'create'
  groupTarget.value = null
  groupName.value = ''
  groupDialogOpen.value = true
}

function openGroupAction(group, action) {
  if (action === 'group-up') return void moveGroup(group.id, -1)
  if (action === 'group-down') return void moveGroup(group.id, 1)
  groupTarget.value = group
  groupName.value = group.name
  groupDialogMode.value = action === 'delete-group' ? 'delete' : 'rename'
  groupDialogOpen.value = true
}

async function submitGroupDialog() {
  if (groupBusy.value) return
  groupBusy.value = true
  try {
    if (groupDialogMode.value === 'create') {
      const name = groupName.value.trim()
      if (!name) return
      customGroups.value.push({ id: `group_${crypto.randomUUID()}`, name, sessions: [] })
    } else if (groupDialogMode.value === 'rename') {
      const name = groupName.value.trim()
      if (!name || !groupTarget.value) return
      groupTarget.value.name = name
    } else if (groupDialogMode.value === 'delete') {
      customGroups.value = customGroups.value.filter(group => group.id !== groupTarget.value?.id)
    }
    await persistGroups()
    groupDialogOpen.value = false
  } finally {
    groupBusy.value = false
  }
}

onMounted(loadGroups)
defineExpose({ openCreateGroup })
</script>

<template>
  <div class="home-sessions">
    <nav class="home-sessions__list" aria-label="会话列表">
      <template v-if="sections.length">
        <section
          v-for="section in sections" :key="section.key" class="home-sessions__group"
          @dragover.prevent @drop="dropOnGroup($event, section.id)"
        >
          <div class="home-sessions__group-head">
            <h2
              class="group-label"
              :draggable="section.custom && !selecting"
              @dragstart="startDrag($event, 'group', section.id)"
              @dragend="endDrag"
            >{{ section.label }}</h2>
            <Menu
              v-if="section.custom && !selecting"
              class="home-sessions__group-menu"
              :label="`${section.label} 的分组操作`"
              :items="groupMenu(customGroups.find(group => group.id === section.id), customGroups.findIndex(group => group.id === section.id))"
              @select="openGroupAction(customGroups.find(group => group.id === section.id), $event)"
            />
          </div>
          <ul class="ui-list session-list-items" :aria-label="section.label">
            <li
              v-for="item in section.items" :key="item.id"
              :draggable="!selecting"
              @dragstart="startDrag($event, 'session', item.id, section.id)"
              @dragend="endDrag"
              @dragover.prevent
              @drop="dropOnSession($event, section.id, item.id)"
            >
              <div class="home-session" :class="{ 'is-active': item.id === activeSessionId, 'is-selected': isSelected(item.id) }">
                <Transition name="session-check">
                  <Checkbox
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
                <Menu
                  v-if="!selecting"
                  class="home-session__menu"
                  :label="`${item.title || '新会话'} 的更多操作`"
                  :items="sessionMenu(item)"
                  @select="onMenuSelect(item, $event)"
                />
              </div>
            </li>
          </ul>
        </section>
      </template>
      <div v-else-if="!groupsReady" class="home-empty"><strong>正在读取会话…</strong></div>
      <div v-else class="home-empty">
        <strong>{{ query ? '没有找到匹配的会话' : '还没有会话' }}</strong>
        <p>{{ query ? '换个关键词试试。' : '点下面的「新建对话」开始。' }}</p>
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

    <Dialog :open="groupDialogOpen" :label="groupDialogMode === 'create' ? '新建分组' : groupDialogMode === 'rename' ? '重命名分组' : '删除分组'" @update:open="groupDialogOpen = $event">
      <form @submit.prevent="submitGroupDialog">
        <p v-if="groupDialogMode === 'delete'">分组会删除，里面的会话会回到“未分组”，会话本身不会被删除。</p>
        <Field v-else v-model="groupName" label="分组名称" placeholder="例如：工作、写作、实验" required maxlength="40" />
        <div class="dialog-actions">
          <Button type="button" :disabled="groupBusy" @click="groupDialogOpen = false">取消</Button>
          <Button type="submit" :disabled="groupBusy">{{ groupDialogMode === 'create' ? '创建' : groupDialogMode === 'rename' ? '保存' : '删除分组' }}</Button>
        </div>
      </form>
    </Dialog>
  </div>
</template>

<style scoped lang="scss" src="../../styles/components/navigation/SessionList.scss"></style>
