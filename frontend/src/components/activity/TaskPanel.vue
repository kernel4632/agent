<!--
会话右侧任务清单：当前任务置顶，待处理独立成组，已完成默认收起。
清单由模型在 update_todo_list 工具里更新；这里只展示进度、任务文字和状态，不做用户可编辑的假复选框。
调用示例：<TaskPanel :open="todoOpen" :todos="todos" @update:open="todoOpen = $event" />
-->
<script setup>
import { computed, ref } from 'vue'
import Dialog from '../../ui/Dialog.vue'
import Icon from '../../ui/Icon.vue'

import { todoStatus } from "../../utils/tool.js"

const props = defineProps({
  open: Boolean,
  todos: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:open'])

const done = computed(() => props.todos.filter(item => item.status === 'completed').length)
const current = computed(() => props.todos.find(item => item.status === 'in_progress') || null)
const pending = computed(() => props.todos.filter(item => item.status === 'pending'))
const completed = computed(() => props.todos.filter(item => item.status === 'completed'))
const showCompleted = ref(false)
const icon = status => todoStatus(status).icon
</script>

<template>
  <Dialog
    class="session-todo-panel"
    :open="open"
    label="任务清单"
    placement="right"
    @update:open="emit('update:open', $event)"
  >
    <div class="session-todo-panel__body">
      <header v-if="todos.length" class="session-todo-panel__head">
        <div class="session-todo-panel__summary">
          <span>当前进度</span>
          <strong>{{ done }} / {{ todos.length }}</strong>
        </div>
        <progress class="ui-progress session-todo-panel__bar" :value="done" :max="todos.length" aria-label="任务完成进度"></progress>
      </header>

      <template v-if="todos.length">
        <section v-if="current" class="session-todo-panel__section session-todo-panel__section--current">
          <span class="session-todo-panel__eyebrow">正在执行</span>
          <div class="session-todo-panel__card is-current">
            <Icon :name="icon(current.status)" :size="17" class="session-todo-panel__icon" :class="`is-${current.status}`" />
            <span class="session-todo-panel__text">{{ current.text }}</span>
          </div>
        </section>

        <section v-if="pending.length" class="session-todo-panel__section">
          <div class="session-todo-panel__section-head">
            <span>待处理</span>
            <span class="session-todo-panel__count">{{ pending.length }}</span>
          </div>
          <div class="session-todo-panel__list">
            <div v-for="(item, index) in pending" :key="`pending-${index}-${item.text}`" class="session-todo-panel__card">
              <Icon :name="icon(item.status)" :size="17" class="session-todo-panel__icon" :class="`is-${item.status}`" />
              <span class="session-todo-panel__text">{{ item.text }}</span>
            </div>
          </div>
        </section>

        <section v-if="completed.length" class="session-todo-panel__section session-todo-panel__section--done">
          <button type="button" class="session-todo-panel__completed-toggle" :aria-expanded="showCompleted" @click="showCompleted = !showCompleted">
            <span>已完成 {{ completed.length }} 项</span>
            <Icon name="down" :size="14" class="session-todo-panel__caret" :class="{ 'is-open': showCompleted }" aria-hidden="true" />
          </button>
          <div v-if="showCompleted" class="session-todo-panel__list session-todo-panel__list--done">
            <div v-for="(item, index) in completed" :key="`done-${index}-${item.text}`" class="session-todo-panel__card is-done">
              <Icon :name="icon(item.status)" :size="17" class="session-todo-panel__icon" :class="`is-${item.status}`" />
              <span class="session-todo-panel__text">{{ item.text }}</span>
            </div>
          </div>
        </section>
      </template>
      <p v-else class="session-todo-panel__empty">还没有任务。模型更新清单后会显示在这里。</p>
    </div>
  </Dialog>
</template>

<style scoped lang="scss" src="../../styles/components/activity/TaskPanel.scss"></style>

