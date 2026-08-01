<!--
主页：顶部搜索，左侧 Workspace，右侧按时间分组展示所选 Workspace 的 Session。
添加、选择、重命名和删除均触发 Command，弹窗只保存尚未提交的局部草稿。
调用示例：App 在 ui.view === 'home' 时渲染 <Sessions />。
-->
<script setup>
import { computed, ref } from 'vue'                                 // 引入搜索、时间分组和弹窗草稿
import { Session } from '../commands/session.js'                    // 引入打开、重命名和删除动作
import { UI } from '../commands/ui.js'                              // 引入搜索和反馈动作
import { Workspace } from '../commands/workspace.js'                // 引入工作区动作
import { formatDateTime, t } from '../i18n.js'                      // 引入响应式界面翻译和时间格式
import { store } from '../store.js'                                 // 引入主页数据

const addWorkspaceOpen = ref(false)                                 // 控制添加工作区弹窗
const workspaceName = ref('')                                      // 保存尚未提交的工作区名称
const workspacePath = ref('')                                      // 保存尚未提交的工作区路径
const editingSessionID = ref('')                                   // 控制列表原位重命名
const editingTitle = ref('')                                       // 保存尚未提交的 Session 标题
const deleteTarget = ref(null)                                     // 控制删除确认弹窗

const query = computed(() => store.ui.search.trim().toLowerCase()) // 统一主页大小写不敏感搜索
const visibleWorkspaces = computed(() => store.workspaces.filter((workspace) => !query.value || workspace.name.toLowerCase().includes(query.value) || workspace.path.toLowerCase().includes(query.value) || workspace.sessions.some((session) => session.title.toLowerCase().includes(query.value)))) // Workspace 名称、路径和内部 Session 都可命中
const activeWorkspace = computed(() => store.workspaces.find((workspace) => workspace.id === store.ui.activeWorkspaceID) || visibleWorkspaces.value[0] || null) // 当前选择不存在时显示首个结果
const visibleSessions = computed(() => (activeWorkspace.value?.sessions || []).filter((session) => !query.value || session.title.toLowerCase().includes(query.value) || session.model.toLowerCase().includes(query.value))) // 右侧只展示当前 Workspace 的匹配 Session

const groups = computed(() => {                                     // 按今天、昨天和更早组织 Session
  const start = new Date(); start.setHours(0, 0, 0, 0)              // 取得今天本地零点
  const yesterday = start.getTime() - 24 * 60 * 60 * 1000          // 取得昨天本地零点
  const result = [
    { id: 'today', label: t('today'), items: [] },
    { id: 'yesterday', label: t('yesterday'), items: [] },
    { id: 'earlier', label: t('earlier'), items: [] },
  ]
  for (const session of [...visibleSessions.value].sort((left, right) => right.updatedAt - left.updatedAt)) {
    if (session.updatedAt >= start.getTime()) result[0].items.push(session) // 今天更新进入第一组
    else if (session.updatedAt >= yesterday) result[1].items.push(session)  // 昨天更新进入第二组
    else result[2].items.push(session)                                      // 其余历史进入最后一组
  }
  return result.filter((group) => group.items.length)                // 空分组不占页面高度
})


// --- 提交新工作区 ---
function addWorkspace() {
  if (!Workspace.add(workspaceName.value, workspacePath.value)) return // 无效草稿保持弹窗
  addWorkspaceOpen.value = false                                      // 成功后关闭弹窗
  workspaceName.value = ''                                            // 清理名称草稿
  workspacePath.value = ''                                            // 清理路径草稿
}


// --- 开始重命名 Session ---
function startRename(session) {
  editingSessionID.value = session.id                                 // 原位切换目标行
  editingTitle.value = session.title                                  // 以当前标题开始编辑
}


// --- 保存 Session 标题 ---
function saveRename() {
  if (!editingSessionID.value) return                                 // 没有目标时无需提交
  if (Session.rename(editingSessionID.value, editingTitle.value)) editingSessionID.value = '' // 保存成功退出编辑
}


// --- 确认删除 Session ---
function confirmDelete() {
  if (deleteTarget.value) Session.remove(deleteTarget.value.id)       // 指令同步摘要和完整会话
  deleteTarget.value = null                                           // 无论结果都关闭确认弹窗
}


// --- 格式化最近活动时间 ---
function formatTime(timestamp) {
  return formatDateTime(timestamp, { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }) // 紧凑展示列表时间
}
</script>

<template>
  <section class="home-view">
    <mdui-text-field class="home-search" variant="filled" clearable :value="store.ui.search" type="search" :placeholder="t('search')" :aria-label="t('search')" @input="UI.setSearch($event.target.value)"><mdui-icon-search slot="icon"></mdui-icon-search><kbd slot="end-icon">Ctrl K</kbd></mdui-text-field>

    <div class="home-body">
      <aside class="workspace-panel">
        <header class="panel-heading">
          <div><h1>{{ t('workspace') }}</h1><span>{{ store.workspaces.length }}</span></div>
          <mdui-button-icon class="icon-command" :aria-label="t('addWorkspace')" :title="t('addWorkspace')" @click="addWorkspaceOpen = true"><mdui-icon-add></mdui-icon-add></mdui-button-icon>
        </header>
        <div class="workspace-list">
          <mdui-card v-for="workspace in visibleWorkspaces" :key="workspace.id" clickable variant="filled" :class="{ 'is-active': activeWorkspace?.id === workspace.id }" @click="Workspace.select(workspace.id)">
            <mdui-avatar class="workspace-icon"><mdui-icon-folder></mdui-icon-folder></mdui-avatar>
            <span><strong>{{ workspace.name }}</strong><small>{{ t('sessionCount', { count: workspace.sessions.length }) }} · {{ workspace.path }}</small></span>
            <mdui-icon-keyboard-arrow-right></mdui-icon-keyboard-arrow-right>
          </mdui-card>
          <div v-if="!visibleWorkspaces.length" class="empty-state compact">{{ t('noWorkspace') }}</div>
        </div>
      </aside>

      <section class="session-panel">
        <header class="panel-heading session-panel__heading">
          <div><h1>{{ activeWorkspace?.name || t('sessions') }}</h1><span>{{ visibleSessions.length }}</span></div>
          <p v-if="activeWorkspace">{{ activeWorkspace.path }}</p>
        </header>

        <div v-if="groups.length" class="session-groups">
          <section v-for="group in groups" :key="group.id" class="session-group">
            <h2>{{ group.label }}</h2>
            <mdui-card v-for="session in group.items" :key="session.id" clickable variant="filled" class="home-session" @click="Session.open(session.id)">
              <mdui-avatar class="home-session__model">{{ session.model.slice(0, 1).toUpperCase() }}</mdui-avatar>
              <div class="home-session__main">
                <mdui-text-field v-if="editingSessionID === session.id" variant="outlined" :value="editingTitle" maxlength="100" :label="t('sessionTitle')" @input="editingTitle = $event.target.value" @click.stop @keydown.enter.prevent="saveRename" @keydown.esc="editingSessionID = ''" @blur="saveRename"></mdui-text-field>
                <strong v-else>{{ session.title }}</strong>
                <small>{{ session.model }} · {{ t('messageCount', { count: session.messageCount }) }} · {{ formatTime(session.updatedAt) }}</small>
              </div>
              <div class="home-session__actions">
                <mdui-button-icon class="icon-command" :aria-label="t('renameSession')" :title="t('rename')" @click.stop="startRename(session)"><mdui-icon-edit></mdui-icon-edit></mdui-button-icon>
                <mdui-button-icon class="icon-command" :aria-label="t('deleteSession')" :title="t('delete')" @click.stop="deleteTarget = session"><mdui-icon-delete></mdui-icon-delete></mdui-button-icon>
              </div>
            </mdui-card>
          </section>
        </div>
        <div v-else class="empty-state">
          <mdui-icon-history></mdui-icon-history>
          <strong>{{ query ? t('noMatchingSessions') : t('noSessions') }}</strong>
          <mdui-button v-if="!query" variant="tonal" @click="Session.create(activeWorkspace?.id)"><mdui-icon-add slot="icon"></mdui-icon-add>{{ t('newChat') }}</mdui-button>
        </div>
      </section>
    </div>

    <mdui-dialog class="workspace-dialog" :open="addWorkspaceOpen" close-on-overlay-click @closed="addWorkspaceOpen = false">
      <span slot="headline">{{ t('addWorkspace') }}</span>
      <span slot="description">{{ t('workspaceDescription') }}</span>
      <div class="dialog-fields"><mdui-text-field variant="outlined" :value="workspaceName" :label="t('name')" :placeholder="t('workspaceNameExample')" @input="workspaceName = $event.target.value"></mdui-text-field><mdui-text-field variant="outlined" :value="workspacePath" :label="t('path')" :placeholder="t('workspacePathExample')" @input="workspacePath = $event.target.value" @keydown.enter="addWorkspace"></mdui-text-field></div>
      <mdui-button slot="action" variant="text" @click="addWorkspaceOpen = false">{{ t('cancel') }}</mdui-button><mdui-button slot="action" variant="filled" :disabled="!workspaceName.trim() || !workspacePath.trim()" @click="addWorkspace">{{ t('add') }}</mdui-button>
    </mdui-dialog>

    <mdui-dialog class="delete-session-dialog" :open="Boolean(deleteTarget)" close-on-overlay-click @closed="deleteTarget = null"><span slot="headline">{{ t('deleteSession') }}</span><span slot="description">{{ deleteTarget ? t('deleteSessionDescription', { title: deleteTarget.title }) : '' }}</span><mdui-button slot="action" variant="text" @click="deleteTarget = null">{{ t('cancel') }}</mdui-button><mdui-button slot="action" variant="filled" class="danger-command" @click="confirmDelete">{{ t('delete') }}</mdui-button></mdui-dialog>
  </section>
</template>

<style lang="scss" src="../styles/views/Sessions.scss"></style>
