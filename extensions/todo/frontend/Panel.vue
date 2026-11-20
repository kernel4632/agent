<!--
任务清单面板（对话顶栏的清单图标打开）：上面一行进度「已完成 n / 共 m」和细进度条，下面每条任务一行，
未完成是空心圆、完成是对勾并变淡划线。清单由模型通过 todo 工具维护，这里只读，随 todo.update 推送实时刷新，切换会话时重读。
-->
<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { CheckmarkCircle02Icon, CircleIcon, CheckListIcon } from '@hugeicons/core-free-icons'

const props = defineProps({ app: { type: Object, required: true } })
const Icon = props.app.shared.Components.Icon
const items = ref([])

async function load() {
    const id = props.app.api.id()
    if (!id) { items.value = []; return }
    const result = await props.app.api.op('todo.list', { id })
    items.value = result.items ?? []
}

const done = computed(() => items.value.filter(item => item.status === 'done').length)

props.app.on('todo.update', data => { items.value = data.items ?? [] })
watch(() => props.app.api.id(), load)
onMounted(load)
</script>

<template>
  <div class="todo">
    <template v-if="items.length">
      <div class="todo__progress">
        <span>已完成 {{ done }} / 共 {{ items.length }}</span>
        <span class="todo__bar"><span :style="{ width: `${(done / items.length) * 100}%` }"></span></span>
      </div>
      <ul class="todo__list">
        <li v-for="item in items" :key="item.id" :class="{ 'is-done': item.status === 'done' }">
          <Icon :icon="item.status === 'done' ? CheckmarkCircle02Icon : CircleIcon" :size="18" />
          <span>{{ item.content }}</span>
        </li>
      </ul>
    </template>
    <div v-else class="todo__empty">
      <Icon :icon="CheckListIcon" :size="28" />
      <strong>还没有任务</strong>
      <p>模型做多步工作时会在这里列出计划和进度。</p>
    </div>
  </div>
</template>

<style scoped>
.todo__progress { display: grid; gap: 8px; margin-bottom: 14px; font-size: 13px; color: var(--muted); }
.todo__bar { display: block; height: 4px; border-radius: 999px; background: var(--soft-strong); overflow: hidden; }
.todo__bar span { display: block; height: 100%; border-radius: inherit; background: var(--success); transition: width .2s; }
.todo__list { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
.todo__list li { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border-radius: 12px; font-size: 14px; line-height: 20px; }
.todo__list li:hover { background: var(--hover); }
.todo__list li :deep(.icon) { margin-top: 1px; color: var(--faint); }
.todo__list li.is-done { color: var(--faint); text-decoration: line-through; }
.todo__list li.is-done :deep(.icon) { color: var(--success); }
.todo__empty { display: grid; justify-items: center; gap: 8px; padding: 48px 12px; text-align: center; color: var(--faint); }
.todo__empty strong { color: var(--text); font-size: 15px; font-weight: 500; }
.todo__empty p { margin: 0; font-size: 13px; }
</style>
