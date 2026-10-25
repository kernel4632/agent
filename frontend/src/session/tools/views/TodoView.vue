<script setup>
import { computed } from 'vue'
import { AppIcon } from '../../../ui/index.js'
import { useToolContent } from '../use-tool-content.js'
import { todoStatus } from '../../todos.js'

const props = defineProps({ tool: { type: Object, required: true } })
const { value } = useToolContent(props)
const items = computed(() => Array.isArray(value.value?.items) ? value.value.items : [])
const icon = status => todoStatus(status).icon              // 和输入框上方清单共用一份状态表
const label = status => todoStatus(status).label
</script>

<template>
  <div v-if="items.length" class="todo-list">
    <div v-for="(item, index) in items" :key="index" class="todo-item">
      <AppIcon :name="icon(item.status)" :size="13" class="todo-item__icon" :class="`is-${item.status}`" />
      <span class="todo-item__text" :class="{ 'is-done': item.status === 'completed' }">{{ item.text }}</span>
      <span class="todo-item__status">{{ label(item.status) }}</span>
    </div>
  </div>
  <p v-else class="tool-empty">暂无任务项</p>
</template>
