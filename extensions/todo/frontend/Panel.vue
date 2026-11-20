<script setup>
import { onMounted, ref, watch } from 'vue'

const props = defineProps({ app: { type: Object, required: true } })
const items = ref([])

async function load() {
    const id = props.app.api.id()
    const result = await props.app.api.op('todo.list', { id })
    items.value = result.items ?? []
}

props.app.on('todo.update', data => { items.value = data.items ?? [] })
watch(() => props.app.api.id(), load)
onMounted(load)
</script>

<template>
  <ul class="todo">
    <li v-if="!items.length" class="todo__empty">还没有任务</li>
    <li v-for="item in items" :key="item.id" :class="{ 'todo--done': item.status === 'done' }">
      <span>{{ item.status === 'done' ? '✓' : '○' }}</span>
      {{ item.content }}
    </li>
  </ul>
</template>

<style scoped>
.todo { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.todo li { display: flex; gap: 8px; font-size: 14px; }
.todo--done { color: var(--muted); text-decoration: line-through; }
.todo__empty { color: var(--faint); }
</style>
