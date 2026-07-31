<!--
Run 执行树：展示当前会话的根 Run 和共享环境中的子 Agent Run。
它只消费 Server 反馈，不控制工具、模型或工作区资源。
调用示例：<RunTree :runs="chat.runs" />。
-->
<script setup>
defineProps({
  runs: { type: Array, default: () => [] },                    // 当前会话的根 Run 和子 Run
})
</script>

<template>
  <section class="run-tree" aria-label="Agent 执行树">
    <span class="run-tree__label">执行</span>
    <span v-for="run in runs" :key="run.runID" class="run-tree__item" :class="`is-${run.status}`" :title="run.input || run.runID">
      {{ run.agentID }} · {{ run.status }}
    </span>
  </section>
</template>
