<script setup>
import { onMounted, ref } from 'vue'

const props = defineProps({ app: { type: Object, required: true } })
const items = ref([])

async function load() { items.value = await props.app.api.op('skill.list') }
async function toggle(item) {
    items.value = await props.app.api.op('skill.toggle', { name: item.name, enabled: !item.enabled })
}
onMounted(load)
</script>

<template>
  <ul class="skill">
    <li v-if="!items.length" class="skill__empty">还没有安装技能。把带 SKILL.md 的目录放到 skills/ 即可。</li>
    <li v-for="item in items" :key="item.name">
      <div>
        <strong>{{ item.title }}</strong>
        <p>{{ item.description }}</p>
      </div>
      <label><input type="checkbox" :checked="item.enabled" @change="toggle(item)"> 启用</label>
    </li>
  </ul>
</template>

<style scoped>
.skill { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
.skill li { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
.skill strong { display: block; font-size: 14px; }
.skill p { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
.skill__empty { color: var(--faint); }
</style>
