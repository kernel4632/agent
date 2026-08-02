<!--
Session 分组：按主页给出的时间组渲染行，并管理原位标题草稿。
组件只发出打开、重命名、删除和新建意图，不读取 Store。
调用示例：<SessionGroups :groups="groups" @open="openSession" />。
-->
<script setup>
import { nextTick, ref } from 'vue'                                    // 保存标题草稿并在切换后聚焦字段
import { t } from '../../i18n.js'                                      // 提供分组和操作文案
import TextField from '../shared/TextField.vue'                       // 使用 M3E 标准标题字段

defineProps({
  groups: { type: Array, default: () => [] },                          // 非空时间分组
})
const emit = defineEmits(['open', 'rename', 'delete'])                 // 将会话业务动作交回主页
const editingSessionID = ref('')                                      // 当前原位编辑行身份
const editingTitle = ref('')                                          // 当前标题草稿
const editingField = ref(null)                                        // 当前唯一可见的标题输入字段


// --- 进入标题编辑 ---
async function startRename(session) {
  editingSessionID.value = session.id                                 // 只切换目标行呈现状态
  editingTitle.value = session.title                                  // 从响应式事实复制局部草稿
  await nextTick()                                                     // 等待目标行替换为输入字段
  editingField.value?.[0]?.select?.()                                  // v-for 模板 ref 返回数组，选中唯一可见字段
}


// --- 请求保存标题 ---
function saveRename() {
  if (!editingSessionID.value) return                                 // 失焦重复事件无需再次提交
  emit('rename', editingSessionID.value, editingTitle.value, (saved) => { if (saved) editingSessionID.value = '' }) // Command 成功后才退出编辑
}
</script>

<template>
  <section class="session-panel">
    <div class="session-groups">
      <section v-for="group in groups" :key="group.id" class="session-group">
        <h2>{{ group.label }}</h2>
        <m3e-card v-for="session in group.items" :key="session.id" actionable class="home-session" :class="{ 'is-editing': editingSessionID === session.id }" @click="emit('open', session.id)">
          <div class="home-session__layout">
            <div class="home-session__main">
              <TextField v-if="editingSessionID === session.id" ref="editingField" v-model="editingTitle" maxlength="100" :label="t('sessionTitle')" @click.stop @keydown.enter.prevent="saveRename" @keydown.esc.stop="editingSessionID = ''" @blur="saveRename" />
              <strong v-else>{{ session.title }}</strong>
            </div>
            <div class="home-session__actions">
              <m3e-icon-button class="icon-command" :aria-label="t('renameSession')" :title="t('rename')" @click.stop="startRename(session)"><m3e-icon name="edit"></m3e-icon></m3e-icon-button>
              <m3e-icon-button class="icon-command" :aria-label="t('deleteSession')" :title="t('delete')" @click.stop="emit('delete', session)"><m3e-icon name="delete"></m3e-icon></m3e-icon-button>
            </div>
          </div>
        </m3e-card>
      </section>
    </div>
  </section>
</template>
