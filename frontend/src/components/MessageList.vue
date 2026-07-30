<!--
消息列表组件：按顺序展示完整会话，并在流式更新时保持视口贴近最新反馈。
列表只负责滚动与消息组合，回滚动作继续向上传递。
调用示例：<MessageList :messages="chat.messages" @rollback="rollback" />。
-->
<script setup>
import { nextTick, ref, watch } from 'vue'            // 引入列表引用和更新后滚动能力
import MessageItem from './MessageItem.vue'          // 引入单条消息展示组件

const props = defineProps({                           // 声明完整消息数组
  messages: { type: Array, required: true },          // 按会话顺序排列的消息
})

const emit = defineEmits(['rollback'])                // 向 Chat 视图透传 checkpoint 动作
const listElement = ref(null)                         // 保存可滚动消息容器元素


// --- 滚动到最新消息 ---
async function scrollToLatest() {
  await nextTick()                                    // 等待当前文本增量完成 DOM 更新
  const element = listElement.value                   // 读取真实滚动容器
  if (!element) return                                // 尚未挂载时无需滚动
  element.scrollTop = element.scrollHeight            // 将最新 Agent 反馈保持在视口底部
}

watch(() => props.messages, scrollToLatest, { deep: true }) // 文本、工具和审批变化均触发滚动
</script>

<template>
  <div ref="listElement" class="message-list">
    <div class="message-list__column">
      <MessageItem v-for="(message, index) in messages" :key="`${message.role}-${index}`" :message="message" @rollback="emit('rollback', $event)" />
    </div>
  </div>
</template>
