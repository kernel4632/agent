<!--
主页原型：使用 M3E 原生组件展示搜索、工作区和按时间分组的会话列表。
当前只验证组件库默认外观与信息结构，不覆盖 M3E 的视觉 token。
调用示例：<HomePage />。
-->
<script setup>
import { computed, reactive, ref, useId } from 'vue'          // 管理页面数据和重命名弹窗

const searchTerm = ref('')                                   // 保存主页搜索关键词
const selectedWorkspaceId = ref('personal')                  // 决定右侧展示哪个工作区的会话
const renameDialog = ref(null)                               // 打开和关闭 M3E 重命名弹窗
const renameInput = ref(null)                                // 弹窗打开后聚焦名称输入框
const renameTarget = ref(null)                               // 保存当前准备重命名的会话
const renameDraft = ref('')                                  // 保存输入中的新会话名称
const renameInputId = `rename-conversation-${useId()}`       // 连接字段标签与输入框

const workspaces = [                                         // 左侧工作区样例数据
  { id: 'personal', name: '个人工作区', description: '8 个会话' },
  { id: 'product', name: '产品团队', description: '5 个会话' },
  { id: 'research', name: '研究项目', description: '3 个会话' },
]

const conversationsByWorkspace = reactive({                 // 右侧按工作区和时间组织会话
  personal: [
    { group: '今天', items: [{ id: 'p-1', title: '整理主页信息架构', time: '14:32' }, { id: 'p-2', title: '侧边栏组件验收', time: '10:18' }] },
    { group: '昨天', items: [{ id: 'p-3', title: 'Agent 输入框交互', time: '昨天' }] },
    { group: '更早', items: [{ id: 'p-4', title: '建立组件预览工程', time: '7 月 30 日' }] },
  ],
  product: [
    { group: '今天', items: [{ id: 't-1', title: '产品需求评审', time: '09:45' }] },
    { group: '更早', items: [{ id: 't-2', title: '版本发布计划', time: '7 月 28 日' }] },
  ],
  research: [
    { group: '昨天', items: [{ id: 'r-1', title: '模型能力对比', time: '昨天' }] },
    { group: '更早', items: [{ id: 'r-2', title: '上下文策略实验', time: '7 月 25 日' }] },
  ],
})

const selectedWorkspace = computed(() => workspaces.find(workspace => workspace.id === selectedWorkspaceId.value)) // 提供右侧标题
const conversationGroups = computed(() => conversationsByWorkspace[selectedWorkspaceId.value] || [])              // 提供右侧分组


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

  renameTarget.value.title = nextTitle                        // 更新响应式会话数据
  await renameDialog.value?.hide('confirm')                   // 提交后关闭弹窗并返回确认结果
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
            <m3e-button type="button" variant="tonal" shape="square">
              <m3e-icon slot="icon" name="add" filled="1"></m3e-icon>
              添加工作区
            </m3e-button>
          </div>

          <m3e-action-list variant="segmented" aria-label="工作区列表">
            <m3e-list-action
              v-for="workspace in workspaces"
              :key="workspace.id"
              :aria-current="workspace.id === selectedWorkspaceId ? 'page' : undefined"
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
                  <m3e-list-action>
                    <m3e-icon slot="leading" name="chat" filled="1"></m3e-icon>
                    {{ conversation.title }}
                    <span slot="supporting-text">{{ conversation.time }}</span>

                    <span slot="trailing" class="home-page__conversation-actions">
                      <m3e-icon-button type="button" shape="rounded" :aria-label="`重命名 ${conversation.title}`" title="重命名" @click.stop="openRenameDialog(conversation)">
                        <m3e-icon name="edit" filled="1"></m3e-icon>
                      </m3e-icon-button>
                      <m3e-icon-button type="button" shape="rounded" :aria-label="`删除 ${conversation.title}`" title="删除" @click.stop>
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

    <m3e-dialog ref="renameDialog" dismissible aria-label="重命名会话">
      <m3e-heading slot="header" variant="headline" size="small" level="2">重命名会话</m3e-heading>

      <div class="home-page__rename-content">
        <m3e-form-field class="home-page__rename-field" variant="outlined">
          <label slot="label" :for="renameInputId">会话名称</label>
          <input :id="renameInputId" ref="renameInput" v-model="renameDraft" type="text" @keydown.enter.prevent="confirmRename" />
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
/* 只定义页面空间关系，所有可见组件样式由 M3E 默认主题提供。 */
.home-page {
  display: flex;
  flex-direction: column;
  gap: 24px;
  width: 100%;
  height: 100%;
  padding: 24px;
  overflow: hidden;
}

.home-page__search {
  align-self: center;
  width: min(720px, 100%);
  transform: scale(1);
  transition: transform var(--motion-duration-spring) var(--motion-spring-bouncy), filter 120ms ease;

  &:hover {
    filter: brightness(1.04);
    transform: scale(1.01);
  }

  &:focus-within {
    filter: brightness(1.04);
    transform: scale(1.015);
  }

  &:active {
    filter: brightness(.98);
    transform: scale(.985);
    transition-duration: var(--motion-duration-press);
    transition-timing-function: ease-out;
  }
}

.home-page__body {
  display: flex;
  overflow: hidden;
  flex: 1 1 0;
  gap: 24px;
  min-height: 0;
}

.home-page__workspace-pane,
.home-page__conversation-pane {
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.home-page__workspace-pane {
  min-width: 240px;
  flex: 0 1 320px;
}

.home-page__conversation-pane {
  flex: 1 1 0;
}

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

.home-page__conversation-groups {
  min-height: 0;
  padding-right: 8px;
  overflow-x: hidden;
  overflow-y: auto;
  flex: 1 1 auto;
  scrollbar-width: thin;
  scrollbar-color: #555555 transparent;

  &::-webkit-scrollbar { width: 8px; }
  &::-webkit-scrollbar-track { background: transparent; }

  &::-webkit-scrollbar-thumb {
    border: 2px solid transparent;
    border-radius: 999px;
    background: #555555;
    background-clip: padding-box;
  }

  &::-webkit-scrollbar-thumb:hover { background-color: #747474; }
}

.home-page__pane-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.home-page__conversation-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

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

.home-page m3e-list-action:has(.home-page__conversation-actions:hover),
.home-page m3e-list-action:has(.home-page__conversation-actions:focus-within) {
  filter: none;
  transform: scale(1);
  transition: none;
}

.home-page m3e-button,
.home-page m3e-icon-button,
.home-page m3e-list-action {
  transform: scale(1);
  transition: transform var(--motion-duration-spring) var(--motion-spring-bouncy), filter 120ms ease;

  &:hover {
    filter: brightness(1.08);
    transform: translateY(-.5px) scale(1.01);
  }

  &:active {
    filter: brightness(.94);
    transform: scale(.96);
    transition-duration: var(--motion-duration-press);
    transition-timing-function: ease-out;
  }
}

.home-page m3e-action-list {
  padding: 8px;
}

@media (max-width: 760px) {
  .home-page {
    height: auto;
    min-height: 100%;
    padding: 16px;
    overflow-x: hidden;
    overflow-y: auto;
  }

  .home-page__body {
    flex-direction: column;
  }

  .home-page__workspace-pane { flex-basis: auto; }
}
</style>
