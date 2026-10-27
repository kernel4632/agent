<!--
会话右侧任务清单：替代原来的文件工作区面板。
清单由模型在 update_todo_list 工具里更新；这里只展示进度、任务文字和状态，不再占用输入框上方。
调用示例：<SessionTodoPanel :open="todoOpen" :todos="todos" @update:open="todoOpen = $event" />
-->
<script setup>
import { computed } from 'vue'
import { KimaDrawer } from '@kernel4632/kima'
import { AppIcon } from '../ui/index.js'
import { KimaProgress } from '@kernel4632/kima'
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

<style scoped lang="scss">
.session-todo-panel { --kima-drawer-max-width: 380px; }
.session-todo-panel__body { display: flex; min-width: 0; flex-direction: column; gap: 20px; }
.session-todo-panel__head { display: grid; gap: 10px; }
.session-todo-panel__summary { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; color: var(--la-muted); font-size: 13px; line-height: 18px; }
.session-todo-panel__summary strong { color: var(--la-text); font-size: 14px; font-weight: 600; }
.session-todo-panel__bar { --kima-progress-height: 4px; }
.session-todo-panel__list { display: flex; min-width: 0; flex-direction: column; }
.session-todo-panel__item { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; align-items: start; gap: 8px; padding: 9px 0; border-bottom: .5px solid var(--la-line); }
.session-todo-panel__item:last-child { border-bottom: 0; }
.session-todo-panel__icon { margin-top: 3px; color: var(--la-muted); }
.session-todo-panel__icon.is-completed { color: var(--la-success); }
.session-todo-panel__icon.is-in_progress { color: var(--la-accent); }
.session-todo-panel__text { min-width: 0; color: var(--la-text); font-size: 14px; line-height: 22px; overflow-wrap: anywhere; }
.session-todo-panel__text.is-done { color: var(--la-muted); text-decoration: line-through; }
.session-todo-panel__status { flex: none; color: var(--la-muted); font-size: 12px; line-height: 20px; white-space: nowrap; }
.session-todo-panel__status.is-completed { color: var(--la-success); }
.session-todo-panel__status.is-in_progress { color: var(--la-accent); }
.session-todo-panel__empty { margin: 0; color: var(--la-muted); font-size: 14px; line-height: 22px; }
@media (prefers-reduced-motion: reduce) {
  .session-todo-panel__bar span { transition: none; }
}
</style>
