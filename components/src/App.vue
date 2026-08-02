<!--
组件预览页：展示当前正在制作的主页原型。
页面使用 M3E 组件外观，并继承项目全局主题与弹簧交互。
调用示例：<HomePage />。
-->
<script setup>
import { reactive, ref } from 'vue'                           // 管理预览页样例数据
import HomePage from './components/HomePage.vue'              // 引入待确认的主页原型

const selectedWorkspaceId = ref('personal')                  // 展示主页的工作区切换能力
const previewWorkspaces = [                                  // 仅供预览页展示 M3E 原生列表
  { id: 'personal', name: '个人工作区', description: '8 个会话' },
  { id: 'product', name: '产品团队', description: '5 个会话' },
  { id: 'research', name: '研究项目', description: '3 个会话' },
]
const previewConversations = reactive({                      // 仅供预览页展示分组、滚动和重命名
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


// --- 响应主页发出的重命名意图 ---
function renamePreviewConversation({ workspaceId, conversationId, title }) {
  const groups = previewConversations[workspaceId] || []      // 定位工作区下的时间分组
  const conversation = groups.flatMap(group => group.items).find(item => item.id === conversationId) // 定位会话
  if (!conversation) return                                  // 数据已变化时不执行更新

  conversation.title = title                                 // 更新预览页响应式数据
}
</script>

<template>
  <m3e-theme color="#a0a0a0" scheme="dark" density="0">
    <main class="preview-page">
      <HomePage
        v-model:workspace-id="selectedWorkspaceId"
        :workspaces="previewWorkspaces"
        :conversations-by-workspace="previewConversations"
        @rename-conversation="renamePreviewConversation"
      />
    </main>
  </m3e-theme>
</template>
