<!--
主页会话视图：独立浏览最近会话，并支持前台、后台打开或删除。
页面只发出用户意图，顶部标签和聊天上下文由 App 统一协调。
调用示例：<Sessions @open="openSession" @new="startNewChat" />。
-->
<script setup>
import SessionTitleEditor from '../components/SessionTitleEditor.vue' // 引入列表原位重命名组件
import { Session } from '../commands/session.js'      // 引入会话摘要刷新指令
import { store } from '../store.js'                     // 引入唯一全局工作台数据

const emit = defineEmits(['open', 'new', 'remove', 'rename']) // 向应用壳层反馈会话动作
const sessions = store.session                         // 只读取真实会话摘要和反馈


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


// --- 重命名会话 ---
function renameSession(sessionID, title, resolve) {
  emit('rename', sessionID, title, resolve)            // 交给 App 同步 Server 摘要和顶部标签
}


</script>

<template>
  <section class="home-view">
    <header class="home-header">
      <div class="home-header__brand"><span>A</span><strong>Agent</strong></div>
      <div class="home-header__actions">
        <mdui-button-icon aria-label="刷新会话" @click="Session.refresh"><mdui-icon-refresh></mdui-icon-refresh></mdui-button-icon>
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
        <div v-for="session in sessions.sessions" :key="session.id" class="session-row" role="button" tabindex="0" @click="openSession($event, session.id)" @keydown.enter.self="openSession($event, session.id)" @auxclick.middle.prevent="openSession($event, session.id)">
          <span class="session-row__icon"><mdui-icon-history></mdui-icon-history></span>
          <span class="session-row__content">
            <SessionTitleEditor :title="session.title" @save="(title, resolve) => renameSession(session.id, title, resolve)" />
            <small>{{ new Date(session.updatedAt || session.createdAt).toLocaleString() }} · {{ session.messageCount }} 条消息</small>
          </span>
          <mdui-button-icon aria-label="删除会话" @click="removeSession($event, session.id)"><mdui-icon-delete></mdui-icon-delete></mdui-button-icon>
        </div>
      </div>
    </div>
  </section>
</template>
