<!--
应用壳层：提供 OpenCode 式固定顶部标签栏，并在主页、会话、工具和设置之间切换。
顶部标签只触发导航；会话读取交给 stores，业务页面只消费当前上下文。
调用示例：createApp(App).mount('#app')。
-->
<script setup>
import { onMounted } from 'vue'                       // 引入应用启动指令触发时机
import Chat from './views/Chat.vue'                   // 引入当前标签对话工作区
import Sessions from './views/Sessions.vue'           // 引入独立主页会话选择区
import Settings from './views/Settings.vue'           // 引入配置管理区
import CapabilityPopover from './components/CapabilityPopover.vue' // 引入顶部运行能力状态窗
import { Chat as ChatCommand } from './commands/chat.js' // 引入标签状态读取指令
import { UI } from './commands/ui.js'                 // 引入界面导航指令
import { Workspace } from './commands/workspace.js'   // 引入跨主体工作区指令
import { store } from './store.js'                  // 引入唯一全局工作台数据

const tabs = store.tabs                               // 读取持久化顶部标签
const ui = store.ui                                    // 读取当前页面


// --- 关闭一个顶部标签 ---
function closeTab(event, tab) {
  event.stopPropagation()                             // 关闭按钮不触发标签选择
  Workspace.closeTab(tab)                             // 将完整关闭流程交给工作区指令
}


onMounted(Workspace.restore)                          // 应用挂载后执行唯一工作区恢复指令
</script>

<template>
  <div class="app-shell">
    <header class="titlebar">
      <mdui-button-icon class="titlebar__home" :class="{ 'is-active': ui.activeView === 'home' }" aria-label="主页" @click="Workspace.openHome">
        <mdui-icon-home></mdui-icon-home>
      </mdui-button-icon>
      <div class="titlebar__tabs" role="tablist" aria-label="已打开会话">
        <button v-for="tab in tabs.items" :key="tab.key" class="session-tab" :class="{ 'is-active': ui.activeView === 'chat' && tabs.activeKey === tab.key }" type="button" role="tab" @click="Workspace.selectTab(tab)">
          <span class="session-tab__status" :class="{ 'is-running': ChatCommand.getStatus(tab.key).running, 'is-approval': ChatCommand.getStatus(tab.key).approval }"></span>
          <span class="session-tab__title">{{ tab.title || '未命名会话' }}</span>
          <mdui-button-icon class="session-tab__close" aria-label="关闭会话" @click="closeTab($event, tab)">
            <mdui-icon-close></mdui-icon-close>
          </mdui-button-icon>
        </button>
      </div>
      <mdui-button-icon class="titlebar__new" aria-label="新建会话" @click="Workspace.startNewChat">
        <mdui-icon-add></mdui-icon-add>
      </mdui-button-icon>
      <div class="titlebar__spacer"></div>
      <CapabilityPopover @open-settings="UI.openSettings($event)" />
      <mdui-button-icon :class="{ 'is-active': ui.activeView === 'settings' }" aria-label="设置" @click="UI.openSettings('models')">
        <mdui-icon-settings></mdui-icon-settings>
      </mdui-button-icon>
    </header>

    <main class="main-area">
      <Sessions v-if="ui.activeView === 'home'" @open="Workspace.openSession" @new="Workspace.startNewChat" @remove="Workspace.removeSession" @rename="Workspace.renameSessionWithFeedback" />
      <Chat v-else-if="ui.activeView === 'chat'" />
      <Settings v-else />
    </main>
  </div>
</template>
