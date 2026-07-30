<!--
会话管理视图：浏览 Server 会话摘要、打开历史或删除不再需要的会话。
所有数据修改通过 session/chat store 完成，成功后切回真实对话历史。
调用示例：App 在 activeView === 'sessions' 时渲染 <Sessions />。
-->
<script setup>
import { onMounted } from 'vue'                       // 引入首次进入刷新能力
import { useChatStore } from '../stores/chat.js'     // 引入对话历史替换动作
import { useSessionStore } from '../stores/session.js' // 引入会话增删改查指令
import { useUIStore } from '../stores/ui.js'         // 引入业务视图切换动作

const chat = useChatStore()                           // 读取并修改当前对话
const sessions = useSessionStore()                    // 读取会话摘要列表
const ui = useUIStore()                               // 读取导航状态


// --- 打开已有会话 ---
async function openSession(sessionID) {
  const session = await sessions.select(sessionID)    // 从 Server 读取完整消息历史
  if (!session) return                                // 请求失败时留在列表展示错误
  chat.loadSession(session)                           // 将完整历史写入对话仓库
  ui.openView('chat')                                 // 切回聊天区反馈打开成功
}


// --- 删除会话并清理当前上下文 ---
async function removeSession(event, sessionID) {
  event.stopPropagation()                             // 删除按钮不触发行级打开动作
  const removed = await sessions.remove(sessionID)    // 删除 Server 内存和磁盘会话
  if (removed && chat.sessionID === sessionID) chat.loadSession(null) // 当前项被删时清空聊天区
}

onMounted(() => sessions.refresh())                   // 每次进入都读取最新持久化列表
</script>

<template>
  <section class="workspace-view">
    <header class="view-header">
      <div>
        <h1>会话</h1>
        <p>{{ sessions.sessions.length }} 个已保存会话</p>
      </div>
      <mdui-button-icon aria-label="刷新会话" @click="sessions.refresh">
        <mdui-icon-refresh></mdui-icon-refresh>
      </mdui-button-icon>
    </header>
    <div v-if="sessions.errorMessage" class="notice notice--error">{{ sessions.errorMessage }}</div>
    <div v-if="sessions.isLoading && !sessions.sessions.length" class="view-loading">正在读取会话…</div>
    <div v-else-if="!sessions.sessions.length" class="view-empty">还没有已保存的会话</div>
    <div v-else class="session-table">
      <button v-for="session in sessions.sessions" :key="session.id" class="session-row" type="button" @click="openSession(session.id)">
        <span class="session-row__icon"><mdui-icon-history></mdui-icon-history></span>
        <span class="session-row__content">
          <strong>{{ session.title || '未命名会话' }}</strong>
          <small>{{ new Date(session.updatedAt || session.createdAt).toLocaleString() }} · {{ session.messageCount }} 条消息</small>
        </span>
        <mdui-button-icon aria-label="删除会话" @click="removeSession($event, session.id)">
          <mdui-icon-delete></mdui-icon-delete>
        </mdui-button-icon>
      </button>
    </div>
  </section>
</template>
