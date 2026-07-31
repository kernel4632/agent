<!--
会话任务坞：参考 OpenCode 将计划放在输入框正上方，收起时展示当前任务。
MDUI Collapse 负责展开交互，组件只消费 Server 已持久化的任务数据。
调用示例：<TaskPanel :tasks="chat.tasks" />。
-->
<script setup>
import { computed } from 'vue'                         // 引入任务进度和当前项派生能力

const props = defineProps({                           // 声明当前会话完整任务清单
  tasks: { type: Array, default: () => [] },          // 每项包含内容、状态和优先级
})

const completedCount = computed(() => props.tasks.filter((task) => task.status === 'completed').length) // 统计完成项
const activeTask = computed(() => props.tasks.find((task) => task.status === 'in_progress') || props.tasks.find((task) => task.status === 'pending') || props.tasks.at(-1)) // 选择收起态预览
const progressLabel = computed(() => `${completedCount.value}/${props.tasks.length}`) // 提供稳定短进度
</script>

<template>
  <mdui-collapse v-if="tasks.length" class="task-dock" accordion>
    <mdui-collapse-item active>
      <div slot="header" class="task-dock__header">
        <span class="task-dock__progress">{{ progressLabel }}</span>
        <span class="task-dock__preview">{{ activeTask?.content }}</span>
        <mdui-icon-expand-more class="task-dock__chevron"></mdui-icon-expand-more>
      </div>
      <div class="task-dock__body">
        <div v-for="(task, index) in tasks" :key="task.id || `${task.content}-${index}`" class="task-dock__item" :class="`is-${task.status}`">
          <mdui-checkbox :checked="task.status === 'completed'" :indeterminate="task.status === 'in_progress'" tabindex="-1" @click.prevent></mdui-checkbox>
          <span>{{ task.content }}</span>
        </div>
      </div>
    </mdui-collapse-item>
  </mdui-collapse>
</template>
