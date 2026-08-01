<!--
Session 分组：按主页给出的时间组渲染行，并管理原位标题草稿。
组件只发出打开、重命名、删除和新建意图，不读取 Store。
调用示例：<SessionGroups :groups="groups" @open="openSession" />。
-->
<script setup>
import { ref } from 'vue'                                              // 保存当前行尚未提交的标题草稿
import { formatDateTime, t } from '../../i18n.js'                      // 提供 Session 摘要和时间格式
import TextField from '../fields/TextField.vue'                       // 使用 M3E 标准标题字段

defineProps({
  groups: { type: Array, default: () => [] },                          // 非空时间分组
  workspace: { type: Object, default: null },                         // 当前 Workspace 标题和路径
  sessionCount: { type: Number, default: 0 },                          // 当前筛选结果数量
  searching: { type: Boolean, default: false },                       // 决定空状态文案和新建入口
})
const emit = defineEmits(['open', 'rename', 'delete', 'create'])       // 将所有业务动作交回主页
const editingSessionID = ref('')                                      // 当前原位编辑行身份
const editingTitle = ref('')                                          // 当前标题草稿


// --- 进入标题编辑 ---
function startRename(session) {
  editingSessionID.value = session.id                                 // 只切换目标行呈现状态
  editingTitle.value = session.title                                  // 从响应式事实复制局部草稿
}


// --- 请求保存标题 ---
function saveRename() {
  if (!editingSessionID.value) return                                 // 失焦重复事件无需再次提交
  emit('rename', editingSessionID.value, editingTitle.value, (saved) => { if (saved) editingSessionID.value = '' }) // Command 成功后才退出编辑
}


// --- 格式化最近活动时间 ---
function formatTime(timestamp) {
  return formatDateTime(timestamp, { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }) // 保持列表时间紧凑
}
</script>

<template>
  <section class="session-panel">
    <header class="panel-heading session-panel__heading">
      <div><h1>{{ workspace?.name || t('sessions') }}</h1><span>{{ sessionCount }}</span></div>
      <p v-if="workspace">{{ workspace.path }}</p>
    </header>

    <div v-if="groups.length" class="session-groups">
      <section v-for="group in groups" :key="group.id" class="session-group">
        <h2>{{ group.label }}</h2>
        <m3e-card v-for="session in group.items" :key="session.id" actionable class="home-session" @click="emit('open', session.id)">
          <div class="home-session__layout">
            <m3e-avatar class="home-session__model">{{ session.model.slice(0, 1).toUpperCase() }}</m3e-avatar>
            <div class="home-session__main">
              <TextField v-if="editingSessionID === session.id" v-model="editingTitle" maxlength="100" :label="t('sessionTitle')" @click.stop @keydown.enter.prevent="saveRename" @keydown.esc="editingSessionID = ''" @blur="saveRename" />
              <strong v-else>{{ session.title }}</strong>
              <small>{{ session.model }} · {{ t('messageCount', { count: session.messageCount }) }} · {{ formatTime(session.updatedAt) }}</small>
            </div>
            <div class="home-session__actions">
              <m3e-icon-button class="icon-command" :aria-label="t('renameSession')" :title="t('rename')" @click.stop="startRename(session)"><m3e-icon name="edit"></m3e-icon></m3e-icon-button>
              <m3e-icon-button class="icon-command" :aria-label="t('deleteSession')" :title="t('delete')" @click.stop="emit('delete', session)"><m3e-icon name="delete"></m3e-icon></m3e-icon-button>
            </div>
          </div>
        </m3e-card>
      </section>
    </div>
    <div v-else class="empty-state">
      <m3e-icon name="history"></m3e-icon>
      <strong>{{ searching ? t('noMatchingSessions') : t('noSessions') }}</strong>
      <m3e-button v-if="!searching" @click="emit('create')"><m3e-icon slot="icon" name="add"></m3e-icon>{{ t('newChat') }}</m3e-button>
    </div>
  </section>
</template>
