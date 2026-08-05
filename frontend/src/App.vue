<!-- 迁移后的应用组合层：只连接业务数据，不修改复制组件的视觉实现。 -->
<script setup>
import { computed, ref } from 'vue'
import ChatComposer from './components/ChatComposer.vue'
import ConversationFlow from './components/ConversationFlow.vue'
import HomePage from './components/HomePage.vue'
import Sidebar from './components/Sidebar.vue'
import SettingsPage from './components/settings/SettingsPage.vue'
import { Chat } from './commands/chat.js'
import { Session } from './commands/session.js'
import { Settings } from './commands/settings.js'
import { UI } from './commands/ui.js'
import { Workspace } from './commands/workspace.js'
import { store } from './store.js'

const sidebarCollapsed = ref(!store.ui.sidebarOpen)
const openedConversations = computed(() => store.ui.openedSessionIDs.map(id => store.sessions[id]).filter(Boolean))
const homeWorkspaces = computed(() => store.workspaces.map(workspace => ({
  id: workspace.id,
  name: workspace.name || workspace.path,
  description: workspace.path,
})))
const conversationsByWorkspace = computed(() => Object.fromEntries(store.workspaces.map(workspace => [workspace.id, [{
  group: '会话',
  items: (workspace.sessions || []).map(session => ({ id: session.id, title: session.title || '新对话', time: '' })),
}]])))
const activeSession = computed(() => store.sessions[store.ui.activeSessionID] || null)
const activeModels = computed(() => store.config.providers[store.config.activeProvider]?.models || [])

async function openSettings() {
  UI.openSettings()
  if (window.innerWidth <= 760) sidebarCollapsed.value = true
}

async function openConversation(sessionID) {
  await Session.open(sessionID)
  if (window.innerWidth <= 760) sidebarCollapsed.value = true
}

async function createConversation() {
  await Session.create()
  if (window.innerWidth <= 760) sidebarCollapsed.value = true
}

async function renameConversation({ conversationId, title }) {
  await Session.rename(conversationId, title)
}

async function submitMessage(content) {
  if (!content.trim() || !activeSession.value) return
  await Chat.send(activeSession.value.id, content)
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
        @new-conversation="createConversation"
        @select-conversation="openConversation"
        @settings="openSettings"
      />

      <main class="app-content">
        <HomePage
          v-if="store.ui.view === 'home'"
          v-model:workspace-id="store.ui.activeWorkspaceID"
          :workspaces="homeWorkspaces"
          :conversations-by-workspace="conversationsByWorkspace"
          @add-workspace="Workspace.select(store.ui.activeWorkspaceID)"
          @select-conversation="openConversation($event.conversationId)"
          @rename-conversation="renameConversation"
          @delete-conversation="Session.remove($event.conversationId)"
        />

        <section v-else-if="store.ui.view === 'chat'" class="chat-page">
          <ConversationFlow />
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
.app-content { min-width: 0; height: 100%; overflow: hidden; flex: 1 1 auto; }
.chat-page { position: relative; height: 100%; overflow: hidden; }
.chat-page__composer { position: absolute; right: 24px; bottom: 20px; left: 24px; max-width: 820px; margin: 0 auto; }
</style>
