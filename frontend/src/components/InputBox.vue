<!--
对话输入组件：接收多行任务描述，并用发送或停止按钮反馈 Agent 状态。
Enter 发送、Shift+Enter 换行；组件只发出 send/stop，不直接调用 API。
调用示例：<InputBox :running="chat.isRunning" @send="send" @stop="stop" />。
-->
<script setup>
import { nextTick, ref } from 'vue'                   // 引入输入焦点恢复能力
import AgentSelector from './AgentSelector.vue'      // 引入当前会话 Agent 选择菜单
import { Chat } from '../commands/chat.js'            // 引入输入提交和草稿修改指令

const props = defineProps({                           // 声明当前 Agent 状态
  running: { type: Boolean, default: false },         // 运行中显示停止按钮并锁定重复发送
  config: { type: Object, default: null },            // 当前提供商、模型列表和活动模型
  agents: { type: Array, default: () => [] },         // Server 返回的 Agent 目录
  agentId: { type: String, default: '' },              // 当前会话选择的 Agent
})

const emit = defineEmits(['send', 'stop', 'select-agent']) // 向 Chat 视图发出用户和 Agent 指令
const content = defineModel({ type: String, default: '' }) // 当前标签独立保存的任务文本
const inputElement = ref(null)                        // 保存 textarea 用于发送后恢复焦点


// --- 提交当前消息 ---
async function submit() {
  if (!Chat.submitInput(content, props.running, emit)) return // 指令校验、清空并提交有效消息
  await nextTick()                                    // 等待输入器恢复空状态
  inputElement.value?.focus()                         // 保持连续对话键盘效率
}


// --- 处理输入键盘动作 ---
function handleKeydown(event) {
  if (event.key !== 'Enter' || event.shiftKey) return // 其他按键和 Shift+Enter 保持文本输入
  event.preventDefault()                              // Enter 不插入换行
  submit()                                            // 触发与发送按钮相同的指令
}
</script>

<template>
  <div class="composer">
    <textarea ref="inputElement" v-model="content" class="composer__input" rows="1" placeholder="问任何问题，或交给 Agent 一个任务" aria-label="消息" @keydown="handleKeydown"></textarea>
    <div class="composer__footer">
      <div class="composer__modes">
        <span class="composer__plus">+</span>
        <AgentSelector :agents="agents" :value="agentId" :disabled="running" @select="emit('select-agent', $event)" />
      </div>
      <mdui-button-icon v-if="running" class="composer__send composer__send--stop" aria-label="停止" @click="emit('stop')">
        <mdui-icon-stop></mdui-icon-stop>
      </mdui-button-icon>
      <mdui-button-icon v-else class="composer__send" :disabled="!content.trim()" aria-label="发送" @click="submit">
        <mdui-icon-send></mdui-icon-send>
      </mdui-button-icon>
    </div>
  </div>
</template>
