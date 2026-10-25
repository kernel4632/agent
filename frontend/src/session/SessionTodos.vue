<!--
输入框上方的任务清单：和 opencode 一样常驻，模型更新清单时立刻跟着变。
默认展开，项目多时只让清单内部滚动，不把输入框挤下去。
-->
<script setup>
import { computed } from 'vue'
import { KimaCard } from '@kernel4632/kima'
import { AppIcon } from '../ui/index.js'

const props = defineProps({
  todos: { type: Array, default: () => [] },
})

const done = computed(() => props.todos.filter(item => item.status === 'completed').length)
const icon = status => status === 'completed' ? 'check' : status === 'in_progress' ? 'clock' : 'info'
const label = status => status === 'completed' ? '已完成' : status === 'in_progress' ? '进行中' : '待处理'
</script>

<template>
  <KimaCard v-if="todos.length" variant="surface" class="session-todos" aria-label="任务清单">
    <div class="session-todos__head">
      <AppIcon name="check" :size="16" />
      <span class="session-todos__title">任务清单</span>
      <span class="session-todos__count">{{ done }} / {{ todos.length }}</span>
    </div>
    <div class="session-todos__list">
      <div v-for="(item, index) in todos" :key="`${index}-${item.text}`" class="session-todos__item">
        <AppIcon :name="icon(item.status)" :size="14" class="session-todos__icon" :class="`is-${item.status}`" />
        <span class="session-todos__text" :class="{ 'is-done': item.status === 'completed' }">{{ item.text }}</span>
        <span class="session-todos__status" :class="`is-${item.status}`">{{ label(item.status) }}</span>
      </div>
    </div>
  </KimaCard>
</template>

<style scoped lang="scss">
.session-todos {
  width: 100%;
  max-height: 180px;
  gap: 8px;
  margin-bottom: 10px;
  padding: 12px 16px;
  border-radius: 18px;
  background: var(--la-layer-01);
}
.session-todos__head { display: flex; align-items: center; gap: 8px; color: var(--la-secondary); font-size: 13px; font-weight: 600; line-height: 18px; }
.session-todos__title { color: var(--la-text); }
.session-todos__count { margin-left: auto; color: var(--la-muted); font-size: 12px; font-weight: 500; }
.session-todos__list { display: flex; min-height: 0; flex-direction: column; gap: 4px; overflow: auto; scrollbar-width: thin; }
.session-todos__item { display: flex; align-items: flex-start; gap: 8px; padding: 3px 0; font-size: 13px; line-height: 19px; }
.session-todos__icon { flex: none; margin-top: 2px; color: var(--la-muted); }
.session-todos__icon.is-completed { color: var(--la-success); }
.session-todos__icon.is-in_progress { color: var(--la-accent); }
.session-todos__text { min-width: 0; color: var(--la-text); overflow-wrap: anywhere; }
.session-todos__text.is-done { color: var(--la-muted); text-decoration: line-through; }
.session-todos__status { flex: none; margin-left: auto; color: var(--la-muted); font-size: 11.5px; }
.session-todos__status.is-completed { color: var(--la-success); }
.session-todos__status.is-in_progress { color: var(--la-accent); }
@media (max-width: 767px) {
  .session-todos { max-height: 132px; margin-bottom: 8px; padding: 10px 12px; border-radius: 16px; }
}
</style>
