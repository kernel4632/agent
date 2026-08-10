<!--
主页组件：使用 M3E 展示搜索、工作区和按时间分组的会话列表。
调用方提供数据并处理添加、打开、重命名和删除意图，组件不依赖具体 Store 或路由。
调用示例：<HomePage :workspaces="workspaces" :conversations-by-workspace="conversations" />。
-->
<script setup>
import { computed, ref, useId } from 'vue'                    // 管理页面选择、过滤和重命名弹窗

const props = defineProps({                                   // 接收工作区与分组会话数据
  workspaces: { type: Array, default: () => [] },
  conversationsByWorkspace: { type: Object, default: () => ({}) },
})
const selectedWorkspaceId = defineModel('workspaceId', { type: [String, Number], default: null }) // 同步当前工作区
const emit = defineEmits(['add-workspace', 'select-conversation', 'rename-conversation', 'delete-conversation']) // 输出业务意图

const searchTerm = ref('')                                   // 保存主页搜索关键词
const renameDialog = ref(null)                               // 打开和关闭 M3E 重命名弹窗
const renameInput = ref(null)                                // 弹窗打开后聚焦名称输入框
const renameTarget = ref(null)                               // 保存当前准备重命名的会话
const renameDraft = ref('')                                  // 保存输入中的新会话名称
const renameInputID = `rename-conversation-${useId()}`       // 连接字段标签与输入框

const effectiveWorkspaceID = computed(() => selectedWorkspaceId.value ?? props.workspaces[0]?.id ?? null)           // 无外部选中值时使用首项
const selectedWorkspace = computed(() => props.workspaces.find(workspace => workspace.id === effectiveWorkspaceID.value)) // 提供右侧标题
const conversationGroups = computed(() => {                 // 按当前工作区和搜索词生成可见分组
  const groups = props.conversationsByWorkspace[effectiveWorkspaceID.value] || []
  const term = searchTerm.value.trim().toLocaleLowerCase()
  if (!term) return groups

  return groups
    .map(group => ({ ...group, items: group.items.filter(conversation => conversation.title.toLocaleLowerCase().includes(term)) }))
    .filter(group => group.items.length > 0)
})


// --- 打开重命名弹窗并预填当前标题 ---
async function openRenameDialog(conversation) {
  renameTarget.value = conversation                           // 保存确认时需要更新的对象
  renameDraft.value = conversation.title                     // 将当前标题带入输入框
  await renameDialog.value?.show()                            // 等待 M3E 完成弹窗打开动画
  renameInput.value?.focus()                                  // 打开后直接进入编辑状态
  renameInput.value?.select()                                 // 选中标题便于立即替换
}


// --- 确认新的会话标题 ---
async function confirmRename() {
  const nextTitle = renameDraft.value.trim()                  // 移除用户误输入的首尾空格
  if (!nextTitle || !renameTarget.value) return               // 空标题或无目标时不修改数据

  emit('rename-conversation', {                               // 将修改交给调用方的 Store 或请求层
    workspaceId: effectiveWorkspaceID.value,
    conversationId: renameTarget.value.id,
    title: nextTitle,
  })
  await renameDialog.value?.hide('confirm')                   // 提交后关闭弹窗并返回确认结果
}


// --- 关闭弹窗后清理临时编辑状态 ---
function resetRenameDialog() {
  renameTarget.value = null                                   // 避免保留已经失效的会话引用
  renameDraft.value = ''                                      // 下次打开时只使用新的目标标题
}
</script>

<template>
  <main class="home-page">
    <!-- 顶部：M3E 原生搜索框。 -->
    <m3e-search-bar class="home-page__search" clearable clear-label="清除搜索">
      <m3e-icon slot="leading" name="search" filled="1"></m3e-icon>
      <input v-model="searchTerm" slot="input" type="search" placeholder="搜索工作区和会话" aria-label="搜索工作区和会话" />
    </m3e-search-bar>

    <div class="home-page__body">
      <!-- 主体左侧：工作区标题、添加按钮和工作区列表。 -->
      <m3e-content-pane class="home-page__workspace-pane">
        <div class="home-page__pane-content">
          <div class="home-page__pane-header">
            <m3e-heading variant="title" size="large" level="2">工作区</m3e-heading>
            <m3e-button type="button" variant="tonal" shape="square" @click="emit('add-workspace')">
              <m3e-icon slot="icon" name="add" filled="1"></m3e-icon>
              添加工作区
            </m3e-button>
          </div>

          <m3e-action-list variant="segmented" aria-label="工作区列表">
            <m3e-list-action
              v-for="workspace in props.workspaces"
              :key="workspace.id"
              :aria-current="workspace.id === effectiveWorkspaceID ? 'page' : undefined"
              @click="selectedWorkspaceId = workspace.id"
            >
              <m3e-icon slot="leading" name="workspaces" filled="1"></m3e-icon>
              {{ workspace.name }}
              <span slot="supporting-text">{{ workspace.description }}</span>
              <m3e-icon slot="trailing" name="chevron_right" filled="1"></m3e-icon>
            </m3e-list-action>
          </m3e-action-list>
        </div>
      </m3e-content-pane>

      <!-- 主体右侧：当前工作区拥有的会话列表。 -->
      <m3e-content-pane class="home-page__conversation-pane">
        <div class="home-page__pane-content">
          <m3e-heading variant="title" size="large" level="2">{{ selectedWorkspace?.name }}</m3e-heading>

          <div class="home-page__conversation-groups">
            <section v-for="group in conversationGroups" :key="group.group" class="home-page__conversation-group">
              <m3e-heading variant="label" size="large" level="3">{{ group.group }}</m3e-heading>

              <m3e-action-list aria-label="会话列表">
                <template v-for="conversation in group.items" :key="conversation.id">
                  <m3e-list-action @click="emit('select-conversation', { workspaceId: effectiveWorkspaceID, conversationId: conversation.id })">
                    <m3e-icon slot="leading" name="chat" filled="1"></m3e-icon>
                    {{ conversation.title }}
                    <span slot="supporting-text">{{ conversation.time }}</span>

                    <span slot="trailing" class="home-page__conversation-actions">
                      <m3e-icon-button type="button" shape="rounded" :aria-label="`重命名 ${conversation.title}`" title="重命名" @click.stop="openRenameDialog(conversation)">
                        <m3e-icon name="edit" filled="1"></m3e-icon>
                      </m3e-icon-button>
                      <m3e-icon-button type="button" shape="rounded" :aria-label="`删除 ${conversation.title}`" title="删除" @click.stop="emit('delete-conversation', { workspaceId: effectiveWorkspaceID, conversationId: conversation.id })">
                        <m3e-icon name="delete" filled="1"></m3e-icon>
                      </m3e-icon-button>
                    </span>
                  </m3e-list-action>
                </template>
              </m3e-action-list>
            </section>
          </div>
        </div>
      </m3e-content-pane>
    </div>

    <m3e-dialog ref="renameDialog" dismissible aria-label="重命名会话" @closed="resetRenameDialog">
      <m3e-heading slot="header" variant="headline" size="small" level="2">重命名会话</m3e-heading>

      <div class="home-page__rename-content">
        <m3e-form-field class="home-page__rename-field" variant="outlined">
          <label slot="label" :for="renameInputID">会话名称</label>
          <input :id="renameInputID" ref="renameInput" v-model="renameDraft" type="text" @keydown.enter.prevent="confirmRename" />
        </m3e-form-field>
      </div>

      <div slot="actions" class="home-page__dialog-actions" end>
        <m3e-button type="button" shape="square">
          <m3e-dialog-action return-value="cancel">取消</m3e-dialog-action>
        </m3e-button>
        <m3e-button type="button" variant="filled" shape="square" @click="confirmRename">确认</m3e-button>
      </div>
    </m3e-dialog>
  </main>
</template>

<style scoped lang="scss">

/* --- 主页整体布局：搜索在顶部，工作区和会话分列下方 --- */
.home-page {
  display: flex;
  flex-direction: column;
  gap: 24px;
  width: 100%;
  height: 100%;
  padding: 24px;
  overflow: hidden;
}

/* --- 搜索框：居中带弹性交互 --- */
.home-page__search {
  align-self: center;
  width: min(720px, 100%);
  @include bounce-interact;

  &:focus-within {
    filter: brightness(1.04);
    transform: scale(1.015);                                          /* 聚焦时略大于悬停 */
  }

  &:active {
    filter: brightness(.98);
    transform: scale(.985);
  }
}

/* --- 主体双栏：左侧工作区列表 + 右侧会话列表 --- */
.home-page__body {
  display: flex;
  overflow: hidden;
  flex: 1 1 0;
  gap: 24px;
  min-height: 0;
}

/* --- 面板通用约束 --- */
.home-page__workspace-pane,
.home-page__conversation-pane {
  height: 100%;
  min-width: 0;
  min-height: 0;
}

/* --- 工作区面板：固定最小宽度 --- */
.home-page__workspace-pane {
  min-width: 240px;
  flex: 0 1 320px;
}

/* --- 会话面板：自适应填充剩余空间 --- */
.home-page__conversation-pane {
  flex: 1 1 0;
}

/* --- 面板内容和分组通用 Flex 布局 --- */
.home-page__pane-content,
.home-page__conversation-groups,
.home-page__conversation-group {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.home-page__pane-content {
  height: 100%;
  min-height: 0;
}

/* --- 会话分组滚动容器 --- */
.home-page__conversation-groups {
  min-height: 0;
  padding-right: 8px;
  overflow-x: hidden;
  overflow-y: auto;
  flex: 1 1 auto;
  @include scrollbar-dark;
}

/* --- 面板标题行：标题 + 添加按钮 --- */
.home-page__pane-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

/* --- 会话操作按钮组：重命名和删除 --- */
.home-page__conversation-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* --- 重命名弹窗内部布局 --- */
.home-page__rename-field { width: 100%; }

.home-page__rename-content {
  display: flex;
  padding: 10px 0 2px;
  overflow: visible;
}

.home-page__dialog-actions {
  display: flex;
  gap: 8px;
}

/* --- 操作按钮悬停时冻结父级列表项变换 --- */
.home-page m3e-list-action:has(.home-page__conversation-actions:hover),
.home-page m3e-list-action:has(.home-page__conversation-actions:focus-within) {
  filter: none;
  transform: scale(1);                                                /* 按钮交互时父级保持稳定 */
  transition: none;
}

.home-page m3e-action-list {
  padding: 8px;
}

/* --- 移动端适配：改为纵向堆叠 --- */
@media (max-width: 760px) {
  .home-page {
    height: auto;
    min-height: 100%;
    padding: 16px;
    overflow-x: hidden;
    overflow-y: auto;
  }

  .home-page__body {
    flex-direction: column;                                           /* 窄屏工作区和会话纵向排列 */
  }

  .home-page__workspace-pane { flex-basis: auto; }
}
</style>
