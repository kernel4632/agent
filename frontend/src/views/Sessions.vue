<!--
主页：顶部搜索，左侧 Workspace，右侧按时间分组展示所选 Workspace 的 Session。
添加、选择、重命名和删除均触发 Command，弹窗只保存尚未提交的局部草稿。
调用示例：App 在 ui.view === 'home' 时渲染 <Sessions />。
-->
<script setup>
import { computed, ref } from 'vue'                                 // 引入搜索、时间分组和弹窗状态
import DeleteSessionDialog from '../components/home/DeleteSessionDialog.vue' // 引入删除确认弹窗
import SessionGroups from '../components/home/SessionGroups.vue'    // 引入 Session 分组列表
import WorkspaceDialog from '../components/home/WorkspaceDialog.vue' // 引入添加 Workspace 弹窗
import WorkspacePanel from '../components/home/WorkspacePanel.vue'  // 引入 Workspace 列表
import SearchField from '../components/fields/SearchField.vue'      // 引入 M3E 搜索字段
import { Session } from '../commands/session.js'                    // 引入打开、重命名和删除动作
import { UI } from '../commands/ui.js'                              // 引入搜索和反馈动作
import { Workspace } from '../commands/workspace.js'                // 引入工作区动作
import { t } from '../i18n.js'                                      // 引入响应式界面翻译
import { store } from '../store.js'                                 // 引入主页数据

const addWorkspaceOpen = ref(false)                                 // 控制添加工作区弹窗
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
function addWorkspace(name, path, resolve) {
  const saved = Workspace.add(name, path)                              // 指令验证并新增响应式事实
  resolve(saved)                                                       // 将结果反馈给局部草稿组件
  if (saved) addWorkspaceOpen.value = false                            // 成功后关闭弹窗
}


// --- 开始重命名 Session ---
function renameSession(sessionID, title, resolve) {
  resolve(Session.rename(sessionID, title))                            // Command 结果反馈给原位编辑组件
}


// --- 确认删除 Session ---
function confirmDelete() {
  if (deleteTarget.value) Session.remove(deleteTarget.value.id)       // 指令同步摘要和完整会话
  deleteTarget.value = null                                           // 无论结果都关闭确认弹窗
}


</script>

<template>
  <section class="home-view">
    <SearchField class="home-search" :model-value="store.ui.search" :label="t('search')" @update:model-value="UI.setSearch"><template #trailing><kbd>Ctrl K</kbd></template></SearchField>

    <div class="home-body">
      <WorkspacePanel :workspaces="visibleWorkspaces" :active-workspace-id="activeWorkspace?.id" :total="store.workspaces.length" @add="addWorkspaceOpen = true" @select="Workspace.select" />
      <SessionGroups :groups="groups" :workspace="activeWorkspace" :session-count="visibleSessions.length" :searching="Boolean(query)" @open="Session.open" @rename="renameSession" @delete="deleteTarget = $event" @create="Session.create(activeWorkspace?.id)" />
    </div>

    <WorkspaceDialog :open="addWorkspaceOpen" @close="addWorkspaceOpen = false" @add="addWorkspace" />
    <DeleteSessionDialog :session="deleteTarget" @close="deleteTarget = null" @confirm="confirmDelete" />
  </section>
</template>

<style lang="scss" src="../styles/views/Sessions.scss"></style>
