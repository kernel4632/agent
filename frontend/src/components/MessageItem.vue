<!--
单条消息：用户消息展示时间与操作，助手消息组合 Markdown、工具和请求状态。
组件不读取 Store，所有动作通过事件交回 Chat 页面。
调用示例：<MessageItem :message="message" @retry="rollbackMessage" />。
-->
<script setup>
import MarkdownContent from './MarkdownContent.vue'                    // 引入安全 Markdown 渲染
import ReasoningBlock from './ReasoningBlock.vue'                      // 引入推理折叠显示
import ToolCall from './ToolCall.vue'                                  // 引入工具展示条
import { formatDateTime, t } from '../i18n.js'                         // 引入响应式翻译和时间格式

defineProps({ message: { type: Object, required: true } })             // 当前用户或助手消息
const emit = defineEmits(['rollback', 'retry', 'approval', 'copy'])     // 向对话页反馈消息动作


// --- 格式化发送时间 ---
function formatTime(timestamp) {
  return formatDateTime(timestamp, { hour: '2-digit', minute: '2-digit' }) // 仅展示当前对话需要的时间
}


// --- 格式化 Token 数量 ---
function formatTokens(value) {
  if (!value) return '0'                                                // 空用量保持稳定宽度
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value) // 大数使用紧凑 k 单位
}
</script>

<template>
  <article class="message" :class="`message--${message.role}`" :data-message-id="message.id">
    <template v-if="message.role === 'user'">
      <div class="user-message__content">{{ message.content }}</div>
      <div v-if="message.files?.length" class="user-message__files"><span v-for="file in message.files" :key="file.id"><mdui-icon-attach-file></mdui-icon-attach-file>{{ file.name }}</span></div>
      <footer class="user-message__meta">
        <time>{{ formatTime(message.createdAt) }}</time>
        <button type="button" :aria-label="t('recallEdit')" :title="t('recallEditTitle')" @click="emit('retry', message)"><mdui-icon-undo></mdui-icon-undo></button>
        <button type="button" :aria-label="t('copyMessage')" :title="t('copy')" @click="emit('copy', message.content)"><mdui-icon-content-copy></mdui-icon-content-copy></button>
      </footer>
    </template>

    <template v-else>
      <ReasoningBlock v-if="message.reasoning" :text="message.reasoning" :streaming="message.isStreaming" />
      <MarkdownContent v-if="message.content" class="message__content" :content="message.content" :streaming="message.isStreaming" />
      <span v-if="message.isStreaming && !message.content" class="message__typing"><i></i><i></i><i></i></span>

      <div v-if="message.tools?.length" class="message__tools">
        <ToolCall v-for="tool in message.tools" :key="tool.id" :tool="tool" @rollback="emit('rollback', $event)" @approval="emit('approval', $event)" />
      </div>

      <div v-if="message.request" class="request-strip" :class="`is-${message.request.status}`">
        <span class="request-strip__spinner"></span>
        <strong>{{ t('apiRequest') }}</strong>
        <template v-if="message.request.status === 'running'"><span>{{ t('receiving') }}</span></template>
        <template v-else-if="message.request.status === 'cancelled'"><span>{{ t('paused') }}</span></template>
        <template v-else><span>{{ t('inputTokens', { count: formatTokens(message.request.input) }) }}</span><span>{{ t('outputTokens', { count: formatTokens(message.request.output) }) }}</span><span v-if="message.request.cache">{{ t('cacheTokens', { count: formatTokens(message.request.cache) }) }}</span><span>{{ message.request.duration }}s</span></template>
      </div>

      <div v-if="message.error" class="message-error"><mdui-icon-error-outline></mdui-icon-error-outline><span>{{ message.error }}</span></div>
    </template>
  </article>
</template>
