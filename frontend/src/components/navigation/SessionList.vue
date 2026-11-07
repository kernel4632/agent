<!--
抽屉会话列：搜索、自定义分组、拖拽编排、更多菜单和重命名/删除弹窗都在这里。
放在 app/Sidebar.vue 的会话区内，桌面和手机的抽屉共用这一份逻辑。
调用示例：<SessionList :sessions="sessions" :active-session-id="id" :query="search" @open="openSession" />。
-->
<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import Checkbox from '../../ui/Checkbox.vue'
import Button from '../../ui/Button.vue'
import Dialog from '../../ui/Dialog.vue'
import Field from '../../ui/Field.vue'
import Icon from '../../ui/Icon.vue'
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
const collapsedKeys = ref(readStoredList('agent.session-collapsed'))
const pinnedIDs = ref(readStoredList('agent.session-pinned'))
const customGroups = ref([])
const groupsReady = ref(false)
const dragging = ref(null)

function readStoredList(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key))
    return Array.isArray(value) ? value.filter(item => typeof item === 'string') : []
  } catch {
    return []
  }
}

function writeStoredList(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* 隐私模式下仅本次生效 */ }
}

const isCollapsed = key => collapsedKeys.value.includes(key)
function toggleGroup(key) {
  collapsedKeys.value = isCollapsed(key)
    ? collapsedKeys.value.filter(item => item !== key)
    : [...collapsedKeys.value, key]
  writeStoredList('agent.session-collapsed', collapsedKeys.value)
}

const isPinned = id => pinnedIDs.value.includes(id)
function togglePin(session) {
  pinnedIDs.value = isPinned(session.id)
    ? pinnedIDs.value.filter(id => id !== session.id)
    : [session.id, ...pinnedIDs.value.filter(id => id !== session.id)]
  writeStoredList('agent.session-pinned', pinnedIDs.value)
}

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
    if (isPinned(item.id)) continue
    const stamp = stampOf(item)
    if (stamp >= startOfToday.getTime()) buckets[0].items.push(item)
    else if (stamp >= startOfYesterday.getTime()) buckets[1].items.push(item)
    else buckets[2].items.push(item)
  }
  return buckets.filter(group => group.items.length)
})

const pinnedItems = computed(() => {
  const byId = new Map(visible.value.map(item => [item.id, item]))
  return pinnedIDs.value.map(id => byId.get(id)).filter(Boolean)
})

const sections = computed(() => {
  const pinned = new Set(pinnedItems.value.map(item => item.id))
  const result = []
  if (pinnedItems.value.length) result.push({ key: 'pinned', id: '', label: '置顶', items: pinnedItems.value, custom: false, pinned: true })
  if (!customGroups.value.length) return [...result, ...dateGroups.value]
  const byId = new Map(visible.value.map(item => [item.id, item]))
  const assigned = new Set()
  for (const group of customGroups.value) {
    const items = group.sessions.map(id => byId.get(id)).filter(item => item && !pinned.has(item.id))
    group.sessions.forEach(id => assigned.add(id))
    const onlyPinned = group.sessions.length > 0 && group.sessions.every(id => pinned.has(id))
    if (items.length || (!props.query.trim() && !onlyPinned)) {
      result.push({ key: `group:${group.id}`, id: group.id, label: group.name, items, custom: true })
    }
  }
  const ungrouped = visible.value.filter(item => !assigned.has(item.id) && !pinned.has(item.id))
  if (ungrouped.length) result.push({ key: 'ungrouped', id: '', label: '未分组', items: ungrouped, custom: false })
  return result
})

watch(() => props.sessions.map(item => item.id), ids => {
  const next = pinnedIDs.value.filter(id => ids.includes(id))
  if (next.length !== pinnedIDs.value.length) {
    pinnedIDs.value = next
    writeStoredList('agent.session-pinned', next)
  }
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

function groupMenu() {
  return [
    { value: 'rename-group', label: '重命名分组' },
    { value: 'delete-group', label: '删除分组' },
  ]
}

function sessionMenu(session) {
  const items = [{ value: 'pin', label: isPinned(session.id) ? '取消置顶' : '置顶' }, ...MENU_ITEMS.map(item => ({ ...item }))]
  if (customGroups.value.length) items.push({ value: 'move-picker', label: '移动到分组…' })
  return items
}

const groupPickerOpen = ref(false)
const pickerSession = ref(null)

function openGroupPicker(session) {
  pickerSession.value = session
  groupPickerOpen.value = true
}

function currentGroupId() {
  return groupOf(pickerSession.value?.id)?.id || ''
}

function chooseGroup(groupId) {
  const session = pickerSession.value
  groupPickerOpen.value = false
  if (session) void moveSession(session.id, groupId)
}

function groupIndex(section) {
  return customGroups.value.findIndex(group => group.id === section.id)
}

function sessionIndex(session) {
  const group = groupOf(session.id)
  return group ? group.sessions.indexOf(session.id) : -1
}

function onMenuSelect(session, action) {
  if (action === 'pin') togglePin(session)
  else if (action === 'move-picker') openGroupPicker(session)
  else if (action === 'rename') openRename(session)
  else if (action === 'delete') openDelete(session)
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
          @dragover.prevent @drop="!section.pinned && dropOnGroup($event, section.id)"
        >
          <div class="home-sessions__group-head">
            <h2
              class="group-label"
              :draggable="section.custom && !selecting"
              @dragstart="startDrag($event, 'group', section.id)"
              @dragend="endDrag"
            >
              <button class="home-sessions__group-toggle" type="button" :aria-expanded="!isCollapsed(section.key)" @click="toggleGroup(section.key)">
                <Icon class="home-sessions__group-chevron" :class="{ 'is-collapsed': isCollapsed(section.key) }" name="down" :size="14" />
                <span>{{ section.label }}</span>
              </button>
            </h2>
            <div v-if="section.custom && !selecting && customGroups.length > 1" class="home-sessions__group-move">
              <button type="button" aria-label="分组上移" :disabled="groupIndex(section) <= 0" @click="moveGroup(section.id, -1)"><Icon name="up" :size="14" /></button>
              <button type="button" aria-label="分组下移" :disabled="groupIndex(section) >= customGroups.length - 1" @click="moveGroup(section.id, 1)"><Icon class="home-sessions__move-down" name="up" :size="14" /></button>
            </div>
            <Menu
              v-if="section.custom && !selecting"
              class="home-sessions__group-menu"
              :label="`${section.label} 的分组操作`"
              :items="groupMenu()"
              @select="openGroupAction(customGroups.find(group => group.id === section.id), $event)"
            />
          </div>
          <div class="home-sessions__group-body" :class="{ 'is-collapsed': isCollapsed(section.key) }" :inert="isCollapsed(section.key) || undefined" :aria-hidden="isCollapsed(section.key)">
            <ul class="ui-list session-list-items" :aria-label="section.label">
              <li
                v-for="item in section.items" :key="item.id"
                :draggable="!selecting"
                @dragstart="startDrag($event, 'session', item.id, section.id)"
                @dragend="endDrag"
                @dragover.prevent
                @drop="!section.pinned && dropOnSession($event, section.id, item.id)"
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
                  <div v-if="!selecting && section.custom && section.items.length > 1" class="home-session__move">
                    <button type="button" :aria-label="`上移 ${item.title || '新会话'}`" :disabled="sessionIndex(item) <= 0" @click="moveSessionWithin(item.id, -1)"><Icon name="up" :size="14" /></button>
                    <button type="button" :aria-label="`下移 ${item.title || '新会话'}`" :disabled="sessionIndex(item) >= groupOf(item.id)?.sessions.length - 1" @click="moveSessionWithin(item.id, 1)"><Icon class="home-sessions__move-down" name="up" :size="14" /></button>
                  </div>
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
          </div>
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

    <Dialog :open="groupPickerOpen" label="移动到分组" @update:open="groupPickerOpen = $event">
      <div class="session-group-picker">
        <button type="button" :class="{ 'is-active': !currentGroupId() }" @click="chooseGroup('')">
          <span>未分组</span><Icon v-if="!currentGroupId()" name="check" :size="18" />
        </button>
        <button v-for="group in customGroups" :key="group.id" type="button" :class="{ 'is-active': currentGroupId() === group.id }" @click="chooseGroup(group.id)">
          <span>{{ group.name }}</span><Icon v-if="currentGroupId() === group.id" name="check" :size="18" />
        </button>
      </div>
    </Dialog>
  </div>
</template>

<style scoped lang="scss" src="../../styles/components/navigation/SessionList.scss"></style>
