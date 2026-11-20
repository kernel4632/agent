<script setup>
import { onMounted, ref } from 'vue'

const props = defineProps({ app: { type: Object, required: true } })
const list = ref([])
const draft = ref({ name: '', url: '', transport: 'http' })
const error = ref('')

async function load() {
    const result = await props.app.api.op('mcp.list', { id: props.app.api.id() })
    list.value = result.list ?? []
}

async function save(next) {
    error.value = ''
    try { list.value = await props.app.api.op('mcp.save', { mcp: next }) }
    catch (item) { error.value = item instanceof Error ? item.message : String(item) }
}

function add() {
    if (!draft.value.name || !draft.value.url) return
    save([...list.value, { ...draft.value, enabled: true }])
    draft.value = { name: '', url: '', transport: 'http' }
}

function remove(name) { save(list.value.filter(item => item.name !== name)) }

async function toggle(item, enabled) {
    const id = props.app.api.id()
    error.value = ''
    try {
        await props.app.api.op(enabled ? 'mcp.open' : 'mcp.close', { id, name: item.name })
        await load()
    } catch (err) { error.value = err instanceof Error ? err.message : String(err) }
}

onMounted(load)
</script>

<template>
  <div class="mcp">
    <p v-if="error" class="mcp__error">{{ error }}</p>
    <article v-for="item in list" :key="item.name" class="mcp__item">
      <div>
        <strong>{{ item.name }}</strong>
        <p>{{ item.url }}</p>
      </div>
      <div class="mcp__ops">
        <label><input type="checkbox" :checked="item.enabled !== false" @change="toggle(item, $event.target.checked)"> 启用</label>
        <button type="button" @click="remove(item.name)">删除</button>
      </div>
    </article>
    <form class="mcp__new" @submit.prevent="add">
      <input v-model="draft.name" placeholder="名称" required>
      <input v-model="draft.url" placeholder="https://…" required>
      <select v-model="draft.transport">
        <option value="http">http</option>
        <option value="sse">sse</option>
      </select>
      <button type="submit">添加</button>
    </form>
  </div>
</template>

<style scoped>
.mcp { display: grid; gap: 14px; }
.mcp__error { color: var(--danger); font-size: 13px; }
.mcp__item { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
.mcp__item p { margin: 4px 0 0; color: var(--muted); font-size: 12px; word-break: break-all; }
.mcp__ops { display: flex; gap: 8px; align-items: center; font-size: 13px; }
.mcp__ops button, .mcp__new button { border: 0; background: var(--soft-strong); border-radius: 999px; padding: 6px 10px; font: inherit; cursor: pointer; }
.mcp__new { display: grid; gap: 8px; }
.mcp__new input, .mcp__new select { border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; font: inherit; background: var(--surface); color: var(--text); }
</style>
