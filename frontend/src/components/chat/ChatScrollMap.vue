<!--
对话快速跳转地图：将每条消息压缩成右侧可点击标记，并提供前后跳转动作。
组件只发出目标消息身份，MessageList 负责真正的 DOM 滚动，避免两个组件共享隐式引用。
调用示例：<ChatScrollMap :messages="messages" @jump="messageList.scrollToMessage" />。
-->
<script setup>
import { computed, ref } from 'vue'                    // 引入消息数量和当前标记状态

const props = defineProps({ messages: { type: Array, required: true } }) // 当前会话可见消息
const emit = defineEmits(['jump'])                     // 向 Chat 页面反馈目标消息身份
const activeIndex = ref(Math.max(0, props.messages.length - 1)) // 默认定位最近一条消息
const messageCount = computed(() => props.messages.length) // 标记数量随真实历史自动变化


// --- 跳转到相邻消息 ---
function move(direction) {
  const nextIndex = Math.min(messageCount.value - 1, Math.max(0, activeIndex.value + direction)) // 将索引限制在消息边界
  if (nextIndex === activeIndex.value) return             // 到达边界时不产生无效跳转
  activeIndex.value = nextIndex                           // 更新当前地图标记
  emit('jump', props.messages[nextIndex].id)              // 将目标交给消息列表滚动
}


// --- 跳转到指定消息 ---
function jump(index) {
  activeIndex.value = index                               // 地图标记跟随点击目标
  emit('jump', props.messages[index].id)                   // 触发真实消息滚动
}
</script>

<template>
  <aside v-if="messageCount" class="message-map" aria-label="对话快速跳转">
    <m3e-icon-button :disabled="activeIndex === 0" aria-label="上一个对话" title="上一个对话" @click="move(-1)"><m3e-icon name="keyboard_arrow_down" style="transform: rotate(180deg)"></m3e-icon></m3e-icon-button>
    <div class="message-map__marks"><button v-for="(message, index) in messages" :key="message.id" class="message-map__mark" :class="{ 'is-active': index === activeIndex, 'is-assistant': message.role === 'assistant' }" :aria-label="`跳转到第 ${index + 1} 条消息`" @click="jump(index)"></button></div>
    <m3e-icon-button :disabled="activeIndex === messageCount - 1" aria-label="下一个对话" title="下一个对话" @click="move(1)"><m3e-icon name="keyboard_arrow_down"></m3e-icon></m3e-icon-button>
  </aside>
</template>
