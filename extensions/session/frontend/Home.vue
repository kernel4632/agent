<!--
会话主页：搜索、分组、最近对话、新建。点一条会作为标签打开，并不在这里常驻左侧栏。
双击改标题和分组；删除会从列表里拿掉，若它正在标签栏里也会关掉那个标签。
-->
<script setup>
import { computed, onMounted, ref } from 'vue'

const props = defineProps({ app: { type: Object, required: true } })
const items = ref([])
const query = ref('')
const editing = ref('')
const draft = ref('')
const groupDraft = ref('')

const groups = computed(() => {
    const map = new Map()
    for (const item of items.value) {
        const key = item.group || '最近'
        const list = map.get(key) ?? []
        list.push(item)
        map.set(key, list)
    }
    return [...map.entries()]
})

async function load() {
    items.value = await props.app.api.op('session.list', { query: query.value })
}

async function create() {
    const item = await props.app.api.op('session.create')
    await load()
    props.app.shell.tabs.open(item.id, item.title)
}

function open(item) { props.app.shell.tabs.open(item.id, item.title) }

async function rename(item) {
    const title = draft.value.trim()
    const group = groupDraft.value.trim()
    editing.value = ''
    if (title && title !== item.title) props.app.shell.tabs.rename(item.id, title)
    if (group !== (item.group || '')) await props.app.api.op('session.group', { id: item.id, group })
    await load()
}

async function remove(item) {
    if (!confirm(`删除「${item.title}」？`)) return
    if (props.app.shell.state.tabs.some(tab => tab.id === item.id)) props.app.shell.tabs.close(item.id)
    await props.app.api.op('session.delete', { id: item.id })
    await load()
}

function start(item) {
    editing.value = item.id
    draft.value = item.title
    groupDraft.value = item.group || ''
}

onMounted(load)
props.app.on('session.rename', () => load())
defineExpose({ load })
</script>

<template>
  <div class="home">
    <div class="home__column">
      <header class="home__head">
        <h1>会话</h1>
        <button type="button" class="home__new hit" @click="create">新会话</button>
      </header>
      <input v-model="query" class="home__search" placeholder="搜索会话" @input="load">
      <section v-for="[group, list] in groups" :key="group" class="home__group">
        <h2>{{ group }}</h2>
        <button
          v-for="item in list"
          :key="item.id"
          type="button"
          class="home__item"
          :class="{ 'is-on': app.shell.session === item.id }"
          @click="open(item)"
          @dblclick="start(item)"
        >
          <span v-if="editing === item.id" class="home__edit" @click.stop>
            <input v-model="draft" placeholder="标题" @blur="rename(item)" @keydown.enter="rename(item)">
            <input v-model="groupDraft" placeholder="分组（可空）" @blur="rename(item)" @keydown.enter="rename(item)">
          </span>
          <span v-else class="home__title">{{ item.title }}</span>
          <span class="home__del hit" title="删除" @click.stop="remove(item)">删除</span>
        </button>
      </section>
      <p v-if="!items.length" class="home__empty">还没有会话。点右上角新建一个。</p>
    </div>
  </div>
</template>

<style scoped>
.home { height: 100%; overflow: auto; }
.home__column { width: 100%; max-width: 796px; margin: 0 auto; padding: 28px 16px 80px; }
.home__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 20px; }
.home__head h1 { margin: 0; font-size: 28px; font-weight: 550; letter-spacing: -.02em; }
.home__new { min-height: 40px; padding: 0 18px; border: 0; border-radius: 999px; background: var(--primary); color: var(--on-primary); font: inherit; font-size: 14px; cursor: pointer; }
.home__search { width: 100%; min-height: 48px; margin-bottom: 28px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--text); padding: 0 18px; font: inherit; font-size: 15px; }
.home__group h2 { margin: 8px 4px 10px; font-size: 13px; font-weight: 550; color: var(--faint); letter-spacing: .04em; }
.home__item { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 52px; padding: 8px 14px; margin-bottom: 6px; border: 0; border-radius: 16px; background: transparent; color: var(--text); font: inherit; font-size: 16px; text-align: left; cursor: pointer; }
.home__item:hover, .home__item.is-on { background: var(--hover); }
.home__title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home__edit { flex: 1; display: grid; gap: 6px; }
.home__item input { width: 100%; min-height: 40px; border: 1px solid var(--line); border-radius: 10px; padding: 0 10px; font: inherit; background: var(--surface); color: var(--text); }
.home__del { flex: none; min-height: 40px; padding: 0 12px; border-radius: 999px; color: var(--muted); font-size: 13px; display: grid; place-items: center; }
.home__del:hover { background: var(--soft-hover); color: var(--text); }
.home__empty { color: var(--faint); text-align: center; margin-top: 40px; }
</style>
