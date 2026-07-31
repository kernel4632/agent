<!--
单条消息组件：区分用户、助手和工具消息，并组合 Markdown、reasoning 与工具调用。
组件不读取 store，所有业务动作通过 rollback 事件交回 Chat 视图。
调用示例：<MessageItem :message="message" @rollback="rollback" />。
-->
<script setup>
import { computed } from 'vue'                       // 引入工具消息结构派生能力
import MarkdownContent from './MarkdownContent.vue' // 引入安全 Markdown、代码和图表展示组件
import ReasoningBlock from './ReasoningBlock.vue'   // 引入模型思考折叠组件
import ToolCall from './ToolCall.vue'                // 引入工具调用展示组件

const props = defineProps({                          // 声明当前消息数据
  message: { type: Object, required: true },         // Server 或流式 store 中的一条消息
})

const emit = defineEmits(['rollback', 'retry', 'approval']) // 将回退和三选一工具动作交回业务视图
const toolResult = computed(() => ({                 // 将持久化 tool 消息适配到 ToolCall 结构
  id: props.message.toolCallId,                      // 工具调用唯一 ID
  name: props.message.name,                          // 工具业务名称
  input: props.message.input ?? null,                // 新历史和实时工具展示真实输入
  output: props.message.result,                      // 真实执行结果
  status: props.message.status,                      // 实时工具的运行或审批状态
  matchedRule: props.message.matchedRule,            // 权限编辑器命中的规则
  scope: props.message.scope,                        // 权限判断使用的范围
  target: props.message.target,                      // 工具实际申请访问的目标
  approvalError: props.message.approvalError,        // 审批请求失败后的原位反馈
}))
</script>

<template>
  <article class="message" :class="`message--${message.role}`">
    <mdui-button-icon v-if="message.role === 'user' && message.id" class="message__retry" aria-label="回退并编辑这条消息" @click="emit('retry', message)">
      <mdui-icon-edit></mdui-icon-edit>
    </mdui-button-icon>
    <div v-if="message.role === 'assistant'" class="message__identity">Agent</div>
    <ReasoningBlock v-if="message.role === 'assistant'" :text="message.reasoning" :streaming="message.isStreaming" />
    <MarkdownContent v-if="message.content" class="message__content" :content="message.content" :streaming="message.isStreaming" />
    <span v-if="message.isStreaming && !message.content" class="message__typing"><i></i><i></i><i></i></span>
    <ToolCall v-if="message.role === 'tool'" :tool-call="toolResult" :step="message.step" @rollback="emit('rollback', $event)" @approval="emit('approval', $event)" />
  </article>
</template>
