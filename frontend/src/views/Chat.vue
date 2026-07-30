<!--
对话业务视图：组合会话、消息、审批和输入组件，执行完整 Agent 对话链路。
触发事件在此转换为 store 指令，成功后刷新 Server 数据，组件只负责效果反馈。
调用示例：App 在 activeView === 'chat' 时渲染 <Chat />。
-->
<script setup>
import { computed, onMounted } from 'vue'             // 引入当前标题派生和配置加载能力
import InputBox from '../components/InputBox.vue'    // 引入任务输入与停止触发组件
import MessageList from '../components/MessageList.vue' // 引入完整消息历史组件
import { useChatStore } from '../stores/chat.js'     // 引入对话数据和 Agent 指令
import { useConfigStore } from '../stores/config.js' // 引入模型列表和即时切换指令
import { useSessionStore } from '../stores/session.js' // 引入会话详情与列表指令

const chat = useChatStore()                           // 读取当前对话状态
const config = useConfigStore()                       // 读取全部可切换模型
const sessions = useSessionStore()                    // 读取当前会话选择状态
const currentSession = computed(() => sessions.sessions.find((item) => item.id === chat.sessionID)) // 查找当前摘要
const title = computed(() => currentSession.value?.title || (chat.hasMessages ? '新会话' : 'Agent')) // 为顶栏反馈上下文


// --- 发送任务并同步会话摘要 ---
async function sendMessage(message) {
  const completed = await chat.send(message)          // 启动 Agent 并持续消费 SSE
  if (chat.sessionID) sessions.selectedID = chat.sessionID // 自动创建时同步真实会话选择
  await sessions.refresh()                            // 用持久化标题和计数刷新侧栏
  return completed                                    // 保留完成状态供后续扩展反馈
}


// --- 回滚并重新加载历史 ---
async function rollback(step) {
  const completed = await chat.rollback(step)         // 请求 Server 截断 checkpoint 后历史
  if (!completed) return                              // 回滚失败时保持当前对话避免伪反馈
  const session = await sessions.select(chat.sessionID) // 读取 Server 实际剩余消息
  if (session) chat.loadSession(session)              // 用真实历史替换当前界面数据
}


// --- 即时切换下一轮模型 ---
async function selectModel({ providerName, modelName }) {
  await config.selectModel(providerName, modelName)   // 将选择写入 Server 并更新输入器反馈
}

onMounted(() => { if (!config.config) config.load() }) // 首次进入对话读取模型服务清单
</script>

<template>
  <section class="chat-view">
    <header class="chat-header">
      <div>
        <strong>{{ title }}</strong>
        <span v-if="chat.isRunning" class="chat-header__status">运行中</span>
      </div>
    </header>

    <div v-if="!chat.hasMessages" class="chat-empty">
      <div class="chat-empty__brand"><span class="chat-empty__symbol">A</span><strong>Agent</strong></div>
    </div>
    <MessageList v-else :messages="chat.messages" @rollback="rollback" />

    <div class="chat-feedback">
      <div v-if="chat.retryNotice" class="notice notice--muted">连接中断，正在进行第 {{ chat.retryNotice.attempt }} 次重试</div>
      <div v-if="chat.errorMessage" class="notice notice--error">{{ chat.errorMessage }}</div>
      <div v-for="approval in chat.approvals" :key="approval.id" class="approval">
        <div class="approval__body">
          <span>需要批准</span>
          <strong>{{ approval.name }}</strong>
          <pre>{{ JSON.stringify(approval.input, null, 2) }}</pre>
        </div>
        <div class="approval__actions">
          <mdui-button variant="text" @click="chat.reject(approval.id)">拒绝</mdui-button>
          <mdui-button variant="filled" @click="chat.approve(approval.id)">允许</mdui-button>
        </div>
      </div>
    </div>

    <footer class="chat-composer">
      <InputBox :running="chat.isRunning" :config="config.config" @send="sendMessage" @stop="chat.stop" @select-model="selectModel" />
      <small>Agent 可能会出错，请检查重要操作。</small>
    </footer>
  </section>
</template>
