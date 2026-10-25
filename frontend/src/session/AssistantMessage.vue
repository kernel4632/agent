<!--
一条助手消息：思考/工具合并成一张嵌套的思考卡片，正文气泡在下方。
头像、名字和模型名不再显示；用户只看到思考步骤、工具和回答。
复制、回退和分支放在右键或长按操作层里，不占用消息下方空间。
-->
<script setup>
import { computed, ref, watch } from 'vue'
import { AppIcon } from '../ui/index.js'
import { UI } from '../commands/ui.js'
import { renderMarkdown } from '../utils/markdown.js'
import './conversation.scss'
import MessageActionTarget from './MessageActionTarget.vue'
import ReasoningStep from './ReasoningStep.vue'
import ToolCallRow from './ToolCallRow.vue'

const props = defineProps({
  message: { type: Object, required: true },
  sessionId: { type: String, required: true },
  running: Boolean,
  canRollback: Boolean,
})
const emit = defineEmits(['rollback', 'fork'])

const expandedSteps = ref(false)
const tools = computed(() => props.message.tools || [])
const stepCount = computed(() => (props.message.reasoning ? 1 : 0) + tools.value.length)
// 流式思考时保持全部步骤可见；结束后超过两步才折叠，只留最后两步。
const canCollapse = computed(() => stepCount.value > 2 && !(props.message.isStreaming && props.message.reasoning))
const hiddenCount = computed(() => canCollapse.value && !expandedSteps.value ? stepCount.value - 2 : 0)
const showReasoning = computed(() => Boolean(props.message.reasoning) && hiddenCount.value === 0)
const visibleTools = computed(() => {
  const hiddenTools = Math.max(0, hiddenCount.value - (props.message.reasoning ? 1 : 0))
  return tools.value.slice(hiddenTools)
})
const menuItems = computed(() => {
  const items = [{ value: 'copy', label: '复制消息', icon: 'copy', disabled: !props.message.content }]
  if (props.canRollback) {
    items.push({ value: 'rollback', label: '回退到这条回复', icon: 'undo' })
    items.push({ value: 'fork', label: '从这里分支', icon: 'branch' })
  }
  return items
})
const preview = computed(() => props.message.content || props.message.reasoning || '')

function onMenu(action) {
  if (action === 'copy') UI.copy(props.message.content)
  else if (action === 'rollback') emit('rollback')
  else if (action === 'fork') emit('fork')
}

watch(() => props.message.isStreaming, streaming => {
  if (streaming) expandedSteps.value = false
})
</script>

<template>
  <div class="assistant-message rikka-message rikka-message--assistant">
    <MessageActionTarget :items="menuItems" :preview="preview" role-label="助手回复" label="助手消息操作" @select="onMenu">
      <div v-if="stepCount" class="cot-card">
        <button v-if="canCollapse" type="button" class="cot-more" :aria-expanded="expandedSteps" @click="expandedSteps = !expandedSteps">
          <span class="cot-more__icon"><AppIcon :name="expandedSteps ? 'up' : 'down'" :size="16" /></span>
          <span>{{ expandedSteps ? '收起步骤' : `展开其余 ${hiddenCount} 步` }}</span>
        </button>
        <div class="cot-steps">
          <ReasoningStep
            v-if="showReasoning"
            :reasoning="message.reasoning"
            :streaming="message.isStreaming"
            :started-at="message.startedAt"
            :finished-at="message.finishedAt"
          />
          <ToolCallRow
            v-for="tool in visibleTools"
            :key="tool.id"
            :tool="tool"
            :session-id="sessionId"
          />
        </div>
      </div>

      <div v-if="message.content" class="rikka-bubble rikka-bubble--assistant" :class="{ 'is-streaming': message.isStreaming }">
        <div class="markdown-body" v-html="renderMarkdown(message.content)"></div>
        <span v-if="message.isStreaming" class="stream-caret" aria-hidden="true"></span>
      </div>

      <div v-if="message.isStreaming && !message.content && !message.reasoning && !tools.length" class="typing" role="status">
        <span></span><span></span><span></span><small>{{ message.retry || '正在思考' }}</small>
      </div>

      <p v-if="message.error" class="message__error" role="alert">{{ message.error }}</p>

      <p v-if="message.request?.input || message.request?.output" class="message__usage">
        输入 {{ message.request.input.toLocaleString() }} <span>·</span>输出 {{ message.request.output.toLocaleString() }} tokens
      </p>
    </MessageActionTarget>
  </div>
</template>
