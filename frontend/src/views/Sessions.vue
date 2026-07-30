<!--
主页会话视图：独立浏览最近会话，并支持前台、后台打开或删除。
页面只发出用户意图，顶部标签和聊天上下文由 App 统一协调。
调用示例：<Sessions @open="openSession" @new="startNewChat" />。
-->
<script setup>
import { onMounted } from 'vue'                       // 引入主页首次刷新能力
import { useSessionStore } from '../stores/session.js' // 引入会话摘要读取指令

const emit = defineEmits(['open', 'new', 'remove'])  // 向应用壳层反馈会话动作
const sessions = useSessionStore()                    // 读取真实会话摘要列表


// --- 按点击方式打开会话 ---
function openSession(event, sessionID) {
  const background = event.ctrlKey || event.metaKey || event.button === 1 // 浏览器式修饰键在后台打开标签
  emit('open', sessionID, !background)                // 普通点击切换，修饰点击只新增
}


// --- 删除会话 ---
function removeSession(event, sessionID) {
  event.stopPropagation()                             // 删除按钮不触发行级打开
  emit('remove', sessionID)                           // 交给 App 同步 Server、标签和上下文
}


onMounted(() => sessions.refresh())                   // 每次回主页读取最新持久化列表
</script>

<template>
  <section class="home-view">
    <header class="home-header">
      <div class="home-header__brand"><span>A</span><strong>Agent</strong></div>
      <div class="home-header__actions">
        <mdui-button-icon aria-label="刷新会话" @click="sessions.refresh"><mdui-icon-refresh></mdui-icon-refresh></mdui-button-icon>
        <mdui-button variant="filled" @click="emit('new')"><mdui-icon-add slot="icon"></mdui-icon-add>新会话</mdui-button>
      </div>
    </header>
    <div class="home-content">
      <div class="home-section-title">
        <div><h1>会话</h1><p>{{ sessions.sessions.length }} 个已保存会话</p></div>
      </div>
      <div v-if="sessions.errorMessage" class="notice notice--error">{{ sessions.errorMessage }}</div>
      <div v-if="sessions.isLoading && !sessions.sessions.length" class="view-loading">正在读取会话...</div>
      <div v-else-if="!sessions.sessions.length" class="view-empty">还没有已保存的会话</div>
      <div v-else class="session-table">
        <button v-for="session in sessions.sessions" :key="session.id" class="session-row" type="button" @click="openSession($event, session.id)" @auxclick.middle.prevent="openSession($event, session.id)">
          <span class="session-row__icon"><mdui-icon-history></mdui-icon-history></span>
          <span class="session-row__content">
            <strong>{{ session.title || '未命名会话' }}</strong>
            <small>{{ new Date(session.updatedAt || session.createdAt).toLocaleString() }} · {{ session.messageCount }} 条消息</small>
          </span>
          <mdui-button-icon aria-label="删除会话" @click="removeSession($event, session.id)"><mdui-icon-delete></mdui-icon-delete></mdui-button-icon>
        </button>
      </div>
    </div>
  </section>
</template>
