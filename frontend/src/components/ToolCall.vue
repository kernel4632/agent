<!--
工具调用组件：展示工具名称、输入、执行结果和 checkpoint 回滚动作。
点击回滚只发出 rollback(step)，由 Chat 视图调用指令并重新读取会话。
调用示例：<ToolCall :tool-call="item" :step="3" @rollback="rollback" />。
-->
<script setup>
const props = defineProps({                          // 声明工具展示所需数据
  toolCall: { type: Object, required: true },        // 名称、输入和输出组成的工具调用
  step: { type: Number, default: 0 },                // 持久化历史中的 checkpoint 步骤
})

const emit = defineEmits(['rollback'])               // 向父视图发出回滚触发


// --- 格式化工具数据 ---
function formatValue(value) {
  if (value === null || value === undefined) return '等待执行' // 尚无结果时提供状态反馈
  if (typeof value === 'string') return value                  // 文本结果直接展示
  return JSON.stringify(value, null, 2)                        // 对象按缩进 JSON 展示
}
</script>

<template>
  <article class="tool-call">
    <header class="tool-call__header">
      <span class="tool-call__mark">›_</span>
      <strong>{{ props.toolCall.name }}</strong>
      <span class="tool-call__status">{{ props.toolCall.output ? '已完成' : '运行中' }}</span>
      <button v-if="step" class="tool-call__rollback" type="button" @click="emit('rollback', step)">回滚</button>
    </header>
    <pre class="tool-call__data">{{ formatValue(props.toolCall.input) }}</pre>
    <pre v-if="props.toolCall.output" class="tool-call__result">{{ formatValue(props.toolCall.output) }}</pre>
  </article>
</template>
