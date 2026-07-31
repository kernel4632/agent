<!--
对话业务视图：组合会话、消息、审批和输入组件，执行完整 Agent 对话链路。
触发事件在此转换为 store 指令，成功后刷新 Server 数据，组件只负责效果反馈。
调用示例：App 在 activeView === 'chat' 时渲染 <Chat />。
-->
<script setup>
import { computed, onMounted, ref } from 'vue'        // 引入当前标题、请求反馈和配置加载能力
import InputBox from '../components/InputBox.vue'    // 引入任务输入与停止触发组件
import MessageList from '../components/MessageList.vue' // 引入完整消息历史组件
import SessionTitleEditor from '../components/SessionTitleEditor.vue' // 引入顶栏原位重命名组件
import TaskPanel from '../components/TaskPanel.vue'   // 引入当前会话任务面板
import { Chat as ChatCommand } from '../commands/chat.js' // 引入对话、审批和回滚指令
import { Config } from '../commands/config.js'       // 引入模型配置指令
import { Workspace } from '../commands/workspace.js' // 引入发送和重命名工作区指令
import { store } from '../store.js' // 引入唯一全局工作台数据

const chat = computed(() => ChatCommand.getConversation()) // 读取当前标签完整对话数据
const config = store.config                            // 只读取全部可切换模型
const sessions = store.session                         // 只读取当前会话摘要
const tabs = store.tabs                                // 只读取当前活动标签
const currentSession = computed(() => sessions.items.find((item) => item.id === chat.value.sessionID)) // 查找当前摘要
const activeTab = computed(() => tabs.items.find((item) => item.key === tabs.activeKey)) // 读取异步标题已更新的活动标签
const title = computed(() => currentSession.value?.title || activeTab.value?.title || (chat.value.messages.length ? '新会话' : 'Agent')) // 为顶栏反馈最新上下文
const draftText = computed({                              // 将输入框双向绑定到当前标签草稿
  get: () => chat.value.draftText,
  set: (value) => { chat.value.draftText = value },
})
const isRenaming = ref(false)                         // 防止标题保存期间重复提交
const renameError = ref('')                          // 顶栏原位展示重命名错误


// --- 发送任务并同步会话摘要 ---
async function sendMessage(message) {
  return Workspace.sendMessage(message)               // 将发送和摘要同步交给工作区指令
}


// --- 即时切换下一轮模型 ---
async function selectModel({ providerName, modelName }) {
  await Config.selectModel(providerName, modelName)   // 将选择写入 Server 并更新配置数据
}


// --- 保存当前会话标题 ---
async function renameSession(nextTitle, resolve) {
  await Workspace.renameCurrentSession(chat.value, nextTitle, resolve, isRenaming, renameError) // 指令管理保存状态、错误和编辑器反馈
}

onMounted(() => { if (!config.current) Config.load() }) // 首次进入对话触发配置读取指令
</script>

<template>
  <section class="chat-view">
    <header class="chat-header">
      <div>
        <SessionTitleEditor v-if="chat.sessionID" :title="title" :busy="isRenaming" compact @save="renameSession" />
        <strong v-else>{{ title }}</strong>
        <span v-if="chat.isRunning" class="chat-header__status">运行中</span>
        <span v-if="renameError" class="chat-header__error">{{ renameError }}</span>
      </div>
    </header>

    <div class="chat-workspace">
      <div v-if="!chat.messages.length" class="chat-empty">
        <div class="chat-empty__brand"><span class="chat-empty__symbol">A</span><strong>Agent</strong></div>
      </div>
      <MessageList v-else :messages="chat.messages" @rollback="ChatCommand.rollback" @retry="ChatCommand.rollbackMessage" @approval="ChatCommand.decide($event.toolCallID, $event.decision)" />
    </div>

    <div class="chat-feedback">
      <div v-if="chat.retryNotice" class="notice notice--muted">连接中断，正在进行第 {{ chat.retryNotice.attempt }} 次重试</div>
      <div v-if="chat.errorMessage" class="notice notice--error">{{ chat.errorMessage }}</div>
    </div>

    <footer class="chat-composer">
      <div v-if="chat.rollback" class="revert-dock">
        <mdui-icon-undo></mdui-icon-undo>
        <span>已回退 {{ chat.rollback.count }} 条消息</span>
        <span v-if="chat.rollback.target?.content" class="revert-dock__preview">{{ chat.rollback.target.content }}</span>
        <button type="button" @click="ChatCommand.undoRollback">撤销回退</button>
      </div>
      <TaskPanel :tasks="chat.tasks" />
      <InputBox v-model="draftText" :running="chat.isRunning" :config="config.current" @send="sendMessage" @stop="ChatCommand.stop" @select-model="selectModel" />
      <small>Agent 可能会出错，请检查重要操作。</small>
    </footer>
  </section>
</template>
