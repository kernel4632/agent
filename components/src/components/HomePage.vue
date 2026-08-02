<!--
主页原型：使用 M3E 原生组件展示搜索、工作区和按时间分组的会话列表。
当前只验证组件库默认外观与信息结构，不覆盖 M3E 的视觉 token。
调用示例：<HomePage />。
-->
<script setup>
import { computed, ref, useId } from 'vue'                    // 管理搜索、工作区选择和唯一菜单 ID

const searchTerm = ref('')                                   // 保存主页搜索关键词
const selectedWorkspaceId = ref('personal')                  // 决定右侧展示哪个工作区的会话
const pageId = useId()                                       // 避免会话菜单在多实例页面中冲突

const workspaces = [                                         // 左侧工作区样例数据
  { id: 'personal', name: '个人工作区', description: '8 个会话' },
  { id: 'product', name: '产品团队', description: '5 个会话' },
  { id: 'research', name: '研究项目', description: '3 个会话' },
]

const conversationsByWorkspace = {                           // 右侧按工作区和时间组织会话
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
}

const selectedWorkspace = computed(() => workspaces.find(workspace => workspace.id === selectedWorkspaceId.value)) // 提供右侧标题
const conversationGroups = computed(() => conversationsByWorkspace[selectedWorkspaceId.value] || [])              // 提供右侧分组


// --- 为每条会话生成稳定的操作菜单 ID ---
function conversationMenuId(conversationId) {
  return `conversation-menu-${pageId}-${conversationId}`      // 连接菜单触发器与对应菜单
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

                    <m3e-icon-button slot="trailing" type="button" shape="rounded" :aria-label="`${conversation.title} 操作`">
                      <m3e-menu-trigger :for="conversationMenuId(conversation.id)">
                        <m3e-icon name="more_vert" filled="1"></m3e-icon>
                      </m3e-menu-trigger>
                    </m3e-icon-button>
                  </m3e-list-action>

                  <m3e-menu :id="conversationMenuId(conversation.id)" placement="bottom-end">
                    <m3e-menu-item>
                      <m3e-icon slot="icon" name="edit" filled="1"></m3e-icon>
                      重命名
                    </m3e-menu-item>
                    <m3e-menu-item>
                      <m3e-icon slot="icon" name="delete" filled="1"></m3e-icon>
                      删除
                    </m3e-menu-item>
                  </m3e-menu>
                </template>
              </m3e-action-list>
            </section>
          </div>
        </div>
      </m3e-content-pane>
    </div>
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
}

.home-page__search {
  align-self: center;
  width: min(720px, 100%);
}

.home-page__body {
  display: flex;
  flex: 1 1 auto;
  gap: 24px;
  min-height: 0;
}

.home-page__workspace-pane,
.home-page__conversation-pane {
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

.home-page__pane-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

@media (max-width: 760px) {
  .home-page {
    height: auto;
    min-height: 100%;
    padding: 16px;
  }

  .home-page__body {
    flex-direction: column;
  }

  .home-page__workspace-pane { flex-basis: auto; }
}
</style>
