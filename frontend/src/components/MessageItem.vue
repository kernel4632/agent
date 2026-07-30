<!--
单条消息组件：区分用户、助手和工具消息，安全渲染 Markdown，并组合 reasoning 与工具调用。
组件不读取 store，所有业务动作通过 rollback 事件交回 Chat 视图。
调用示例：<MessageItem :message="message" @rollback="rollback" />。
-->
<script setup>
import { computed } from 'vue'                       // 引入安全 HTML 派生能力
import ReasoningBlock from './ReasoningBlock.vue'   // 引入模型思考折叠组件
import ToolCall from './ToolCall.vue'                // 引入工具调用展示组件
import { renderMarkdown } from '../utils/markdown.js' // 引入安全 Markdown 转换

const props = defineProps({                          // 声明当前消息数据
  message: { type: Object, required: true },         // Server 或流式 store 中的一条消息
})

const emit = defineEmits(['rollback'])               // 将 checkpoint 动作交回业务视图
const html = computed(() => renderMarkdown(props.message.content ?? '')) // 转换模型或用户正文
const toolResult = computed(() => ({                 // 将持久化 tool 消息适配到 ToolCall 结构
  id: props.message.toolCallId,                      // 工具调用唯一 ID
  name: props.message.name,                          // 工具业务名称
  input: null,                                       // 历史 tool 消息不重复保存输入
  output: props.message.result,                      // 真实执行结果
}))
</script>

<template>
  <article class="message" :class="`message--${message.role}`">
    <div v-if="message.role === 'assistant'" class="message__identity">Agent</div>
    <ReasoningBlock v-if="message.role === 'assistant'" :text="message.reasoning" :streaming="message.isStreaming" />
    <div v-if="message.content" class="message__content markdown" v-html="html"></div>
    <span v-if="message.isStreaming && !message.content" class="message__typing"><i></i><i></i><i></i></span>
    <div v-if="message.toolCalls?.length" class="message__tools">
      <ToolCall v-for="toolCall in message.toolCalls" :key="toolCall.id" :tool-call="toolCall" @rollback="emit('rollback', $event)" />
    </div>
    <ToolCall v-if="message.role === 'tool'" :tool-call="toolResult" :step="message.step" @rollback="emit('rollback', $event)" />
  </article>
</template>
