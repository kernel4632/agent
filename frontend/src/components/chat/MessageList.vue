<!--
消息列表：顺序展示完整会话，流式更新时自动贴近底部，并暴露消息跳转动作。
列表只处理滚动反馈；回退、复制和审批继续向上传递。
调用示例：messageList.scrollToMessage(messageID)。
-->
<script setup>
import { nextTick, ref } from 'vue'                                  // 引入列表 DOM 和更新后滚动
import MessageAssistant from './MessageAssistant.vue'                // 引入单条消息显示
import { watchMessages } from '../../watchers.js'                    // 引入集中消息监听

const props = defineProps({ messages: { type: Array, required: true } }) // 当前完整可见历史
const emit = defineEmits(['rollback', 'retry', 'approval', 'copy'])      // 向 Chat 透传用户动作
const listElement = ref(null)                                           // 保存真实滚动容器


// --- 滚动到最新消息 ---
async function scrollToLatest() {
  const element = listElement.value                                     // 读取滚动容器当前阅读位置
  if (element && element.scrollHeight - element.scrollTop - element.clientHeight > 180) return // 用户正在看历史时不强行夺回滚动位置
  await nextTick()                                                       // 等待文本增量进入 DOM
  if (element) element.scrollTop = element.scrollHeight                 // 用户贴近底部时保持最新反馈可见
}


// --- 跳转到指定消息 ---
function scrollToMessage(messageID) {
  const message = listElement.value?.querySelector(`[data-message-id="${CSS.escape(messageID)}"]`) // 在当前会话内查找消息
  message?.scrollIntoView({ behavior: 'smooth', block: 'center' })      // 将目标平滑带到阅读区中部
}


// --- 跳转相邻消息 ---
function scrollAdjacent(messageID, direction) {
  const index = props.messages.findIndex((message) => message.id === messageID) // 查找当前消息顺序
  const target = props.messages[index + direction]                      // 读取上一个或下一个消息
  if (target) scrollToMessage(target.id)                                // 存在目标时执行同一跳转
  return target?.id || messageID                                        // 地图保存新的活动身份
}

watchMessages(() => {                                                   // 只跟随时间线末端，不让历史工具审批把阅读位置拉到底部
  const latest = props.messages.at(-1)                                 // 读取当前最后一条消息的流式状态
  return `${props.messages.length}|${latest?.content || ''}|${latest?.request?.status || ''}|${latest?.isStreaming || false}`
}, scrollToLatest)
defineExpose({ scrollToMessage, scrollAdjacent, scrollToLatest })        // 对话页快速地图使用这些命令
</script>

<template>
  <div ref="listElement" class="message-list">
    <div class="message-list__column">
      <MessageAssistant v-for="message in messages" :key="message.id" :message="message" @rollback="emit('rollback', $event)" @retry="emit('retry', $event)" @approval="emit('approval', $event)" @copy="emit('copy', $event)" />
    </div>
  </div>
</template>

<style lang="scss" src="../../styles/components/MessageList.scss"></style>
