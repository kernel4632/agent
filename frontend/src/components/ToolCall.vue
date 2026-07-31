<!--
工具调用组件：展示精确工具、目标、权限规则、执行结果和 checkpoint 回滚动作。
点击审批只发出三选一决定，由 Chat 视图调用指令并反馈失败状态。
调用示例：<ToolCall :tool-call="item" :step="3" @rollback="rollback" />。
-->
<script setup>
const props = defineProps({                          // 声明工具展示所需数据
  toolCall: { type: Object, required: true },        // 名称、输入和输出组成的工具调用
  step: { type: Number, default: 0 },                // 持久化历史中的 checkpoint 步骤
})

const emit = defineEmits(['rollback', 'approval'])     // 向父视图发出回滚或三选一审批动作
const statusLabels = {                                // 将内部状态转换为用户可读反馈
  waiting: '等待批准',
  deciding: '正在提交',
  rejected: '已拒绝',
  running: '运行中',
  completed: '已完成',
}


// --- 格式化工具数据 ---
function formatValue(value) {
  if (value === null || value === undefined) return '等待执行' // 尚无结果时提供状态反馈
  if (typeof value === 'string') return value                  // 文本结果直接展示
  return JSON.stringify(value, null, 2)                        // 对象按缩进 JSON 展示
}


// --- 提交一个审批决定 ---
function decide(decision) {
  emit('approval', { toolCallID: props.toolCall.id, decision }) // 将工具身份和决定作为一个明确事件交回业务层
}
</script>

<template>
  <article class="tool-call">
    <header class="tool-call__header">
      <span class="tool-call__mark">›_</span>
      <strong>{{ props.toolCall.name }}</strong>
      <span class="tool-call__status">{{ statusLabels[props.toolCall.status] || (props.toolCall.output !== null && props.toolCall.output !== undefined ? '已完成' : '运行中') }}</span>
      <button v-if="step" class="tool-call__rollback" type="button" @click="emit('rollback', step)">回滚</button>
    </header>
    <pre class="tool-call__data">{{ formatValue(props.toolCall.input) }}</pre>
    <pre v-if="props.toolCall.output !== null && props.toolCall.output !== undefined" class="tool-call__result">{{ formatValue(props.toolCall.output) }}</pre>
    <footer v-if="['waiting', 'deciding'].includes(props.toolCall.status)" class="tool-call__approval">
      <div class="tool-call__permission">
        <span v-if="props.toolCall.target"><small>目标</small><code>{{ props.toolCall.target }}</code></span>
        <span v-if="props.toolCall.matchedRule"><small>规则</small><code>{{ props.toolCall.matchedRule }}</code></span>
        <span v-if="!props.toolCall.target && !props.toolCall.matchedRule"><small>范围</small><code>{{ props.toolCall.scope || 'default' }}</code></span>
      </div>
      <div v-if="props.toolCall.approvalError" class="notice notice--error">{{ props.toolCall.approvalError }}</div>
      <div class="tool-call__approval-actions">
        <mdui-button variant="text" :disabled="props.toolCall.status === 'deciding'" @click="decide('deny')">拒绝</mdui-button>
        <mdui-button variant="tonal" :disabled="props.toolCall.status === 'deciding'" @click="decide('allow-once')">仅本次允许</mdui-button>
        <mdui-button variant="filled" :disabled="props.toolCall.status === 'deciding'" @click="decide('always-allow')">始终允许</mdui-button>
      </div>
    </footer>
  </article>
</template>
