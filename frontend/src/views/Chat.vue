<!--
对话页：组合标题、上下文、完整消息、任务、回退、操作框和右侧快速跳转地图。
所有用户动作进入 Session、Chat 或 UI 指令，页面只持有确认弹窗和跳转身份。
调用示例：App 在 ui.view === 'chat' 时渲染 <Chat />。
-->
<script setup>
import { computed, ref } from 'vue'                                  // 引入当前会话、模型目录和弹窗状态
import InputBox from '../components/InputBox.vue'                    // 引入对话操作框
import MessageList from '../components/MessageList.vue'              // 引入消息时间线和跳转动作
import SessionTitleEditor from '../components/SessionTitleEditor.vue' // 引入双击标题编辑器
import TaskPanel from '../components/TaskPanel.vue'                   // 引入当前任务列表
import { Chat as ChatCommand } from '../commands/chat.js'             // 引入发送、停止、审批和回退
import { Session } from '../commands/session.js'                      // 引入重命名和模型切换
import { UI } from '../commands/ui.js'                                // 引入复制反馈
import { t } from '../i18n.js'                                        // 引入响应式界面翻译
import { store } from '../store.js'                                  // 引入当前 Session 和全局模型目录

const pendingRollback = ref(null)                                    // 控制工具回退确认弹窗
const session = computed(() => store.sessions[store.ui.activeSessionID] || null) // 当前完整会话
const models = computed(() => Object.entries(store.config.providers).flatMap(([provider, config]) => config.enabled ? config.models.map((model) => ({ provider, model })) : [])) // 只展示启用供应商模型
const contextPercent = computed(() => Math.min(100, Math.round((session.value?.contextTokens || 0) / Math.max(1, session.value?.contextLimit || 1) * 100))) // 圆环和悬浮详情共享百分比


// --- 保存当前标题 ---
function renameTitle(title, resolve) {
  resolve(Session.rename(session.value.id, title))                    // 编辑器只在真实修改成功后退出
}


// --- 切换 Session 模型 ---
function selectModel(value) {
  const [provider, ...modelParts] = value.split('/')                  // Provider 名称和模型 ID 从选择值还原
  Session.selectModel(session.value.id, provider, modelParts.join('/')) // 指令更新详情和摘要
}


// --- 请求工具回退确认 ---
function requestRollback(checkpoint) {
  pendingRollback.value = checkpoint                                 // 打开确认弹窗而不立即改变历史
}


// --- 确认工具回退 ---
function confirmRollback() {
  ChatCommand.rollback(session.value.id, pendingRollback.value)      // 指令暂存指定步骤后的消息
  pendingRollback.value = null                                       // 关闭确认弹窗
}


</script>

<template>
  <section v-if="session" class="chat-view">
    <header class="chat-header">
      <div class="chat-header__title"><SessionTitleEditor :title="session.title" compact @save="renameTitle" /><small>{{ t('doubleClickRename') }}</small></div>
      <div class="context-meter" tabindex="0" :aria-label="t('contextStats')">
        <mdui-circular-progress :value="contextPercent" max="100"></mdui-circular-progress>
        <span>{{ contextPercent }}</span>
        <div class="context-popover">
          <strong>{{ t('context') }}</strong>
          <div><span>{{ t('used') }}</span><b>{{ session.contextTokens.toLocaleString() }}</b></div>
          <div><span>{{ t('limit') }}</span><b>{{ session.contextLimit.toLocaleString() }}</b></div>
          <div><span>{{ t('ratio') }}</span><b>{{ contextPercent }}%</b></div>
        </div>
      </div>
    </header>
    <mdui-linear-progress v-if="session.status === 'running'" class="chat-progress"></mdui-linear-progress>

    <div class="chat-body">
      <div v-if="!session.messages.length" class="chat-empty"><span>A</span><h1>{{ t('startTask') }}</h1></div>
      <MessageList v-else :messages="session.messages" @rollback="requestRollback" @retry="ChatCommand.rollbackMessage(session.id, $event.id)" @approval="ChatCommand.decide(session.id, $event.toolCallID, $event.decision)" @copy="UI.copy" />
    </div>

    <footer class="chat-footer">
      <div v-if="session.rollback" class="rollback-preview">
        <mdui-icon-undo></mdui-icon-undo><span><strong>{{ t('rolledBack') }}</strong><small>{{ session.rollback.preview }}</small></span><mdui-button variant="text" @click="ChatCommand.undoRollback(session.id)">{{ t('undoRollback') }}</mdui-button>
      </div>
      <TaskPanel :tasks="session.tasks" />
      <InputBox v-model="session.draft" :session="session" :models="models" @send="ChatCommand.send(session.id, $event)" @stop="ChatCommand.stop(session.id)" @select-model="selectModel" @attach="ChatCommand.attach(session.id, $event)" @remove-file="ChatCommand.removeFile(session.id, $event)" />
    </footer>

    <mdui-dialog class="rollback-dialog" :open="Boolean(pendingRollback)" close-on-overlay-click @closed="pendingRollback = null"><span slot="headline">{{ t('rollbackTool') }}</span><span slot="description">{{ t('rollbackDescription', { step: pendingRollback }) }}</span><mdui-button slot="action" variant="text" @click="pendingRollback = null">{{ t('cancel') }}</mdui-button><mdui-button slot="action" variant="filled" @click="confirmRollback">{{ t('confirmRollback') }}</mdui-button></mdui-dialog>
  </section>
</template>

<style lang="scss" src="../styles/views/Chat.scss"></style>
