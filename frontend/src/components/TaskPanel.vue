<!--
会话任务面板：将 Server 任务清单压缩为进度、状态、优先级和可扫描条目。
面板只消费会话详情或 SSE 的最新清单，不在本组件内制造并发写入。
调用示例：<TaskPanel :tasks="chat.tasks" />。
-->
<script setup>
import { computed } from 'vue'                         // 引入任务计数和进度派生能力

const props = defineProps({                           // 声明当前会话完整任务清单
  tasks: { type: Array, default: () => [] },          // 每项包含 content、status 和 priority
})

const statusLabels = { pending: '待处理', in_progress: '进行中', completed: '已完成', cancelled: '已取消' } // 状态转换为紧凑中文
const priorityLabels = { high: '高', medium: '中', low: '低' } // 优先级转换为单字扫描标签
const completedCount = computed(() => props.tasks.filter((task) => task.status === 'completed').length) // 统计真实完成项
const activeCount = computed(() => props.tasks.filter((task) => task.status === 'in_progress').length) // 统计当前执行项
const progress = computed(() => props.tasks.length ? Math.round((completedCount.value / props.tasks.length) * 100) : 0) // 将完成数转换为百分比
</script>

<template>
  <aside v-if="tasks.length" class="task-panel" aria-label="会话任务">
    <header class="task-panel__header">
      <div><strong>任务</strong><span>{{ completedCount }}/{{ tasks.length }}</span></div>
      <small v-if="activeCount">{{ activeCount }} 进行中</small>
      <small v-else>{{ progress }}%</small>
    </header>
    <div class="task-panel__progress" role="progressbar" :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: `${progress}%` }"></span></div>
    <ol class="task-panel__list">
      <li v-for="(task, index) in tasks" :key="task.id || `${task.content}-${index}`" :class="[`is-${task.status}`, `priority-${task.priority}`]">
        <span class="task-panel__state" :title="statusLabels[task.status]" :aria-label="statusLabels[task.status]"></span>
        <span class="task-panel__content">{{ task.content }}</span>
        <span class="task-panel__priority" :title="`${priorityLabels[task.priority]}优先级`">{{ priorityLabels[task.priority] }}</span>
      </li>
    </ol>
  </aside>
</template>
