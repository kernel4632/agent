<!--
应用组合层：连接 store 数据和 commands 指令，将业务状态映射为复用组件的 props 和事件。
本文件只负责触发入口角色：接收用户交互事件，调用对应指令，不做数据计算和业务判断。
调用示例：Vite 从 main.js 挂载本文件的根组件。
-->
<script setup>
import { ref } from 'vue'                                           // 引入侧边栏本地状态
import ChatComposer from './components/ChatComposer.vue'            // 引入对话输入编辑器
import ConversationFlow from './components/ConversationFlow.vue'    // 引入对话消息时间线
import HomePage from './components/HomePage.vue'                    // 引入工作区与会话主页
import Sidebar from './components/Sidebar.vue'                      // 引入导航侧边栏
import SettingsPage from './components/settings/SettingsPage.vue'   // 引入设置页面
import { Chat } from './commands/chat.js'                           // 引入消息发送指令
import { Session } from './commands/session.js'                     // 引入会话创建、打开和删除指令
import { Settings } from './commands/settings.js'                   // 引入设置快照保存指令
import { UI, openedConversations, homeWorkspaces, conversationsByWorkspace, activeSession, activeModels } from './commands/ui.js' // 引入页面导航、反馈和派生视图数据
import { Workspace } from './commands/workspace.js'                 // 引入工作区选择指令
import { store } from './store.js'                                  // 引入全局工作台数据

const sidebarCollapsed = ref(!store.ui.sidebarOpen)                 // 侧边栏展开状态由本地 ref 驱动过渡动画


// --- 提交用户消息 ---
async function submitMessage(content) {
  if (!content.trim() || !activeSession.value) return               // 空消息或无会话时不触发发送
  await Chat.send(activeSession.value.id, content)                  // 调用对话指令完成发送和事件订阅
}
</script>

<template>
  <m3e-theme color="#a0a0a0" scheme="dark" density="0">
    <div class="preview-page">
      <Sidebar
        v-model:collapsed="sidebarCollapsed"
        :conversations="openedConversations"
        :active-conversation-id="store.ui.activeSessionID"
        @home="UI.openHome"
        @new-conversation="Session.create()"
        @select-conversation="Session.open($event)"
        @close-conversation="Session.closeOpened($event)"
        @settings="UI.openSettings()"
      />

      <main class="app-content">
        <HomePage
          v-if="store.ui.view === 'home'"
          v-model:workspace-id="store.ui.activeWorkspaceID"
          :workspaces="homeWorkspaces"
          :conversations-by-workspace="conversationsByWorkspace"
          @add-workspace="Workspace.add"
          @select-conversation="Session.open($event.conversationId)"
          @rename-conversation="Session.rename($event.conversationId, $event.title)"
          @delete-conversation="Session.remove($event.conversationId)"
        />

        <section v-else-if="store.ui.view === 'chat'" class="chat-page">
          <div class="chat-page__scroll">
            <ConversationFlow />
          </div>
          <div class="chat-page__composer">
            <ChatComposer :models="activeModels" :selected-model="activeSession?.model || activeModels[0]" @submit="submitMessage" />
          </div>
        </section>

        <SettingsPage v-else @save="Settings.replaceDraftAndSave" />
      </main>
    </div>
  </m3e-theme>
</template>

<style scoped lang="scss">
/* --- 主内容区自适应填充 --- */
.app-content { min-width: 0; height: 100%; overflow: hidden; flex: 1 1 auto; }

/* --- 对话页：flex 布局，内容滚动，composer 固定底部 --- */
.chat-page { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.chat-page__scroll { flex: 1 1 0; overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; scrollbar-color: #555555 transparent; }
.chat-page__scroll::-webkit-scrollbar { width: 8px; }
.chat-page__scroll::-webkit-scrollbar-track { background: transparent; }
.chat-page__scroll::-webkit-scrollbar-thumb { border: 2px solid transparent; border-radius: 999px; background: #555555; background-clip: padding-box; }
.chat-page__scroll::-webkit-scrollbar-thumb:hover { background-color: #747474; }
.chat-page__composer { flex: 0 0 auto; padding: 12px 24px 20px; max-width: 820px; width: 100%; margin: 0 auto; }
</style>
