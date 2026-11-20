<!--
会话侧栏：搜索、按分组列出、新建、改名、删除。当前会话高亮。
-->
<script setup>
import { computed, onMounted, ref } from 'vue'

const props = defineProps({
    api: { type: Object, required: true },
    current: { type: String, default: '' },
})
const emit = defineEmits(['open', 'create'])

const items = ref([])
const query = ref('')
const editing = ref('')
const draft = ref('')
const groupDraft = ref('')

const groups = computed(() => {
    const map = new Map()
    for (const item of items.value) {
        const key = item.group || '会话'
        const list = map.get(key) ?? []
        list.push(item)
        map.set(key, list)
    }
    return [...map.entries()]
})

async function load() {
    items.value = await props.api.op('session.list', { query: query.value })
}

async function create() {
    const item = await props.api.op('session.create')
    await load()
    emit('create', item)
}

async function rename(item) {
    const title = draft.value.trim()
    const group = groupDraft.value.trim()
    editing.value = ''
    if (title && title !== item.title) await props.api.op('session.rename', { id: item.id, title })
    if (group !== (item.group || '')) await props.api.op('session.group', { id: item.id, group })
    await load()
}

async function remove(item) {
    if (!confirm(`删除「${item.title}」？`)) return
    await props.api.op('session.delete', { id: item.id })
    await load()
    emit('open', items.value[0]?.id)
}

function start(item) {
    editing.value = item.id
    draft.value = item.title
    groupDraft.value = item.group || ''
}

onMounted(load)
defineExpose({ load })
</script>

<template>
  <aside class="side">
    <div class="side__bar">
      <input v-model="query" class="side__search" placeholder="搜索会话" @input="load">
      <button class="side__new" type="button" title="新会话" @click="create">+</button>
    </div>
    <div class="side__list">
      <section v-for="[group, list] in groups" :key="group" class="side__group">
        <h3>{{ group }}</h3>
        <button
          v-for="item in list"
          :key="item.id"
          type="button"
          class="side__item"
          :class="{ 'side__item--on': item.id === current }"
          @click="emit('open', item.id)"
          @dblclick="start(item)"
        >
          <span v-if="editing === item.id" class="side__edit" @click.stop>
            <input v-model="draft" placeholder="标题" @blur="rename(item)" @keydown.enter="rename(item)">
            <input v-model="groupDraft" placeholder="分组（可空）" @blur="rename(item)" @keydown.enter="rename(item)">
          </span>
          <span v-else class="side__title">{{ item.title }}</span>
          <span class="side__del" title="删除" @click.stop="remove(item)">×</span>
        </button>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.side { display: flex; flex-direction: column; width: 260px; height: 100%; background: var(--bg); border-right: 1px solid var(--line-soft); }
.side__bar { display: flex; gap: 8px; padding: 12px; }
.side__search { flex: 1; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--text); padding: 8px 12px; font: inherit; font-size: 13px; }
.side__new { width: 32px; height: 32px; border: 0; border-radius: 999px; background: var(--soft-strong); color: var(--text); font-size: 18px; cursor: pointer; }
.side__list { overflow: auto; padding: 0 8px 16px; }
.side__group h3 { margin: 12px 8px 6px; font-size: 12px; font-weight: 550; color: var(--faint); letter-spacing: .04em; }
.side__item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 10px; border: 0; border-radius: 10px; background: transparent; color: var(--text); font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
.side__item:hover, .side__item--on { background: var(--hover); }
.side__title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.side__edit { flex: 1; display: grid; gap: 4px; }
.side__item input { width: 100%; border: 1px solid var(--line); border-radius: 6px; padding: 2px 6px; font: inherit; }
.side__del { opacity: 0; color: var(--muted); padding: 0 4px; }
.side__item:hover .side__del { opacity: 1; }
</style>
