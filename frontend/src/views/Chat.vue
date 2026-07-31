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
import { useChatStore } from '../stores/chat.js'     // 引入对话数据和 Agent 指令
import { useConfigStore } from '../stores/config.js' // 引入模型列表和即时切换指令
import { useSessionStore } from '../stores/session.js' // 引入会话详情与列表指令
import { useTabStore } from '../stores/tabs.js'       // 引入顶部标签标题同步动作

const chat = useChatStore()                           // 读取当前对话状态
const config = useConfigStore()                       // 读取全部可切换模型
const sessions = useSessionStore()                    // 读取当前会话选择状态
const tabs = useTabStore()                            // 读取当前活动标签
const currentSession = computed(() => sessions.sessions.find((item) => item.id === chat.sessionID)) // 查找当前摘要
const activeTab = computed(() => tabs.tabs.find((item) => item.key === tabs.activeKey)) // 读取异步标题已更新的活动标签
const title = computed(() => currentSession.value?.title || activeTab.value?.title || (chat.hasMessages ? '新会话' : 'Agent')) // 为顶栏反馈最新上下文
const isRenaming = ref(false)                         // 防止标题保存期间重复提交
const renameError = ref('')                          // 顶栏原位展示重命名错误


// --- 发送任务并同步会话摘要 ---
async function sendMessage(message) {
  const completed = await chat.send(message)          // 启动 Agent 并持续消费 SSE
  await sessions.refresh()                            // 用持久化标题和计数刷新主页
  tabs.syncTitles(sessions.sessions)                  // 将异步标题同步到全部顶部标签
  return completed                                    // 保留完成状态供后续扩展反馈
}


// --- 即时切换下一轮模型 ---
async function selectModel({ providerName, modelName }) {
  await config.selectModel(providerName, modelName)   // 将选择写入 Server 并更新输入器反馈
}


// --- 保存当前会话标题 ---
async function renameSession(nextTitle, resolve) {
  if (!chat.sessionID) return resolve(false)          // 未发送草稿没有可持久化会话
  isRenaming.value = true                             // 标题动作进入保存反馈
  renameError.value = ''                             // 清除旧失败信息
  const result = await sessions.rename(chat.sessionID, nextTitle) // 让 Server 验证并持久化标题
  if (result) tabs.setTitle(tabs.activeKey, result.title) // 同步当前顶部标签
  else renameError.value = sessions.errorMessage     // 在编辑器附近保留错误原因
  isRenaming.value = false                            // 恢复标题编辑动作
  resolve(Boolean(result))                            // 通知编辑器成功退出或保留草稿
}

onMounted(() => { if (!config.config) config.load() }) // 首次进入对话读取模型服务清单
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
      <div v-if="!chat.hasMessages" class="chat-empty">
        <div class="chat-empty__brand"><span class="chat-empty__symbol">A</span><strong>Agent</strong></div>
      </div>
      <MessageList v-else :messages="chat.messages" @rollback="chat.rollback" @retry="chat.rollbackMessage" @approval="chat.decide($event.toolCallID, $event.decision)" />
    </div>

    <div class="chat-feedback">
      <div v-if="chat.retryNotice" class="notice notice--muted">连接中断，正在进行第 {{ chat.retryNotice.attempt }} 次重试</div>
      <div v-if="chat.errorMessage" class="notice notice--error">{{ chat.errorMessage }}</div>
    </div>

    <footer class="chat-composer">
      <div v-if="chat.rollbackState" class="revert-dock">
        <mdui-icon-undo></mdui-icon-undo>
        <span>已回退 {{ chat.rollbackState.count }} 条消息</span>
        <span v-if="chat.rollbackState.target?.content" class="revert-dock__preview">{{ chat.rollbackState.target.content }}</span>
        <button type="button" @click="chat.undoRollback">撤销回退</button>
      </div>
      <TaskPanel :tasks="chat.tasks" />
      <InputBox v-model="chat.draftText" :running="chat.isRunning" :config="config.config" @send="sendMessage" @stop="chat.stop" @select-model="selectModel" />
      <small>Agent 可能会出错，请检查重要操作。</small>
    </footer>
  </section>
</template>
