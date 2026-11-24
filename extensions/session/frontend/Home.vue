<!--
会话主页：标题旁是「新会话」主按钮，下面是胶囊搜索框，再按分组列出会话（标题 + 相对时间）。
点一行把它作为标签打开；行尾两个圆形图标钮改名、删除（触屏上也常显）。改名在行内展开标题和分组两个输入框。
-->
<script setup>
import { computed, onMounted, ref } from 'vue'
import { Delete02Icon, PencilEdit02Icon, PlusSignIcon, Search01Icon } from '@hugeicons/core-free-icons'

const props = defineProps({ app: { type: Object, required: true } })
const Icon = props.app.shared.Components.Icon
/** @typedef {{ id: string, title: string, group?: string, updatedAt?: number }} SessionEntry */
/** @type {import('vue').Ref<Array<SessionEntry>>} */
const items = ref([])
const query = ref('')
const editing = ref('')
const draft = ref('')
const groupDraft = ref('')

/** @type {import('vue').ComputedRef<Array<[string, Array<SessionEntry>]>>} */
const groups = computed(() => {
    const map = new Map()
    for (const item of items.value) map.set(item.group || '最近', [...(map.get(item.group || '最近') ?? []), item])
    return [...map.entries()]
})

// 相对时间：今天内说「几分钟前 / 几小时前」，更早的写日期。
/** @param {number} time @returns {string} */
function when(time) {
    if (!time) return ''
    const minutes = Math.floor((Date.now() - time) / 60000)
    if (minutes < 1) return '刚刚'
    if (minutes < 60) return `${minutes} 分钟前`
    if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} 小时前`
    if (minutes < 48 * 60) return '昨天'
    const date = new Date(time)
    return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

async function load() { items.value = await props.app.api.op('session.list', { query: query.value }) }
async function create() {
    const item = await props.app.api.op('session.create')
    props.app.shell.tabs.open(item.id, item.title)
}
/** @param {SessionEntry} item */
function open(item) { if (editing.value !== item.id) props.app.shell.tabs.open(item.id, item.title) }
/** @param {SessionEntry} item */
function start(item) {
    editing.value = item.id
    draft.value = item.title
    groupDraft.value = item.group || ''
}
/** @param {SessionEntry} item */
async function save(item) {
    if (editing.value !== item.id) return
    const title = draft.value.trim()
    const group = groupDraft.value.trim()
    editing.value = ''
    if (title && title !== item.title) props.app.shell.tabs.rename(item.id, title)
    if (group !== (item.group || '')) await props.app.api.op('session.group', { id: item.id, group })
    await load()
}
/** @param {SessionEntry} item */
async function remove(item) {
    if (!confirm(`删除「${item.title}」？`)) return
    if (props.app.shell?.state.tabs.some(/** @param {{ id: string }} tab */ tab => tab.id === item.id)) props.app.shell.tabs.close(item.id)
    await props.app.api.op('session.delete', { id: item.id })
    await load()
}

onMounted(load)
props.app.on('session.rename', () => load())
</script>

<template>
  <div class="home">
    <div class="home__column">
      <header class="home__head">
        <h1>会话</h1>
        <button type="button" class="home__new" @click="create"><Icon :icon="PlusSignIcon" :size="18" />新会话</button>
      </header>
      <label class="home__search">
        <Icon :icon="Search01Icon" :size="18" />
        <input v-model="query" type="search" placeholder="搜索会话" aria-label="搜索会话" @input="load">
      </label>
      <section v-for="[group, list] in groups" :key="group" class="home__group">
        <h2>{{ group }}</h2>
        <div v-for="item in list" :key="item.id" class="home__row" :class="{ 'is-on': app.shell.session === item.id }" @click="open(item)">
          <div v-if="editing === item.id" class="home__edit" @click.stop @focusout="$event.relatedTarget?.closest?.('.home__edit') || save(item)">
            <input v-model="draft" placeholder="标题" aria-label="标题" @keydown.enter="save(item)">
            <input v-model="groupDraft" placeholder="分组（可留空）" aria-label="分组" @keydown.enter="save(item)">
          </div>
          <div v-else class="home__copy">
            <span class="home__title">{{ item.title }}</span>
            <span class="home__time">{{ when(item.updatedAt) }}</span>
          </div>
          <button type="button" class="home__round hit" aria-label="改名" title="改名和分组" @click.stop="start(item)"><Icon :icon="PencilEdit02Icon" :size="17" /></button>
          <button type="button" class="home__round hit" aria-label="删除" title="删除" @click.stop="remove(item)"><Icon :icon="Delete02Icon" :size="17" /></button>
        </div>
      </section>
      <p v-if="!items.length" class="home__empty">{{ query ? '没有找到会话' : '还没有会话，点「新会话」开始。' }}</p>
    </div>
  </div>
</template>

<style scoped>
.home { height: 100%; overflow-y: auto; }
.home__column { width: 100%; max-width: 760px; margin: 0 auto; padding: 32px 20px 80px; }
.home__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 20px; }
.home__head h1 { margin: 0; font-size: 28px; font-weight: 450; letter-spacing: -.01em; }
.home__new { display: inline-flex; align-items: center; gap: 6px; height: 40px; padding: 0 18px 0 14px; border: 0; border-radius: 999px; background: var(--primary); color: var(--on-primary); font: inherit; font-size: 14px; font-weight: 550; cursor: pointer; }
.home__new:hover { opacity: .88; }
.home__search { display: flex; align-items: center; gap: 10px; height: 48px; margin-bottom: 28px; padding: 0 18px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--faint); }
.home__search:focus-within { border-color: var(--line-strong); }
.home__search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text); font: inherit; font-size: 15px; }
.home__group + .home__group { margin-top: 20px; }
.home__group h2 { margin: 0 0 6px; padding: 0 12px; font-size: 13px; font-weight: 500; color: var(--faint); }
.home__row { display: flex; align-items: center; gap: 4px; min-height: 56px; padding: 6px 8px 6px 14px; border-radius: 16px; cursor: pointer; }
.home__row:hover { background: var(--hover); }
.home__row.is-on { background: var(--soft-strong); }
.home__copy { display: flex; align-items: baseline; gap: 12px; flex: 1; min-width: 0; }
.home__title { flex: 1; min-width: 0; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home__time { flex: none; font-size: 13px; color: var(--faint); }
.home__edit { display: grid; grid-template-columns: 2fr 1fr; gap: 8px; flex: 1; min-width: 0; }
.home__edit input { min-width: 0; height: 38px; padding: 0 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--text); font: inherit; }
.home__round { display: grid; place-items: center; flex: none; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--faint); cursor: pointer; }
.home__round:hover { background: var(--soft-hover); color: var(--text); }
.home__empty { margin-top: 48px; text-align: center; color: var(--faint); }
@media (max-width: 640px) {
  .home__column { padding: 20px 12px 64px; }
  .home__head h1 { font-size: 24px; }
  .home__edit { grid-template-columns: 1fr; }
  .home__copy { flex-direction: column; gap: 2px; align-items: stretch; }
}
</style>
