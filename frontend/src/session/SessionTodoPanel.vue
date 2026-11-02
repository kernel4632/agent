<!--
会话右侧任务清单：替代原来的文件工作区面板。
清单由模型在 update_todo_list 工具里更新；这里只展示进度、任务文字和状态，不再占用输入框上方。
调用示例：<SessionTodoPanel :open="todoOpen" :todos="todos" @update:open="todoOpen = $event" />
-->
<script setup>
import { computed } from 'vue'
import { KimaDrawer } from '../ui/index.js'
import { AppIcon } from '../ui/index.js'
import { KimaProgress } from '../ui/index.js'
import { todoStatus } from './todos.js'

const props = defineProps({
  open: Boolean,
  todos: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:open'])

const done = computed(() => props.todos.filter(item => item.status === 'completed').length)
const icon = status => todoStatus(status).icon
const label = status => todoStatus(status).label
</script>

<template>
  <KimaDrawer
    class="session-todo-panel"
    :open="open"
    title="任务清单"
    placement="right"
    @update:open="emit('update:open', $event)"
  >
    <div class="session-todo-panel__body">
      <header v-if="todos.length" class="session-todo-panel__head">
        <div class="session-todo-panel__summary">
          <span>当前进度</span>
          <strong>{{ done }} / {{ todos.length }}</strong>
        </div>
        <KimaProgress class="session-todo-panel__bar" :value="done" :max="todos.length" label="任务完成进度" />
      </header>

      <div v-if="todos.length" class="session-todo-panel__list">
        <div v-for="(item, index) in todos" :key="`${index}-${item.text}`" class="session-todo-panel__item">
          <AppIcon :name="icon(item.status)" :size="16" class="session-todo-panel__icon" :class="`is-${item.status}`" />
          <span class="session-todo-panel__text" :class="{ 'is-done': item.status === 'completed' }">{{ item.text }}</span>
          <span class="session-todo-panel__status" :class="`is-${item.status}`">{{ label(item.status) }}</span>
        </div>
      </div>
      <p v-else class="session-todo-panel__empty">还没有任务。模型更新清单后会显示在这里。</p>
    </div>
  </KimaDrawer>
</template>

<style scoped lang="scss" src="../styles/session/SessionTodoPanel.scss"></style>
