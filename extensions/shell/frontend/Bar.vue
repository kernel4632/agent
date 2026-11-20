<!--
最顶上一栏：左侧入口（会话）、已打开的会话标签、标签旁的 +、右侧入口（设置）。
标签可以点选、双击改名、点 × 从条上拿掉（会话本身还在列表里）。样式走 Grok 的暖中性色，按键都带 .hit。
-->
<script setup>
import { computed, ref } from 'vue'
import { state } from './state.js'

const props = defineProps({ shell: { type: Object, required: true } })
const editing = ref('')
const draft = ref('')

const current = computed(() => state.session)

function open(id) { props.shell.tabs.open(id) }
function close(id, event) { event.stopPropagation(); props.shell.tabs.close(id) }
function start(item) { editing.value = item.id; draft.value = item.title }
function commit(item) {
    const title = draft.value.trim()
    editing.value = ''
    if (title && title !== item.title) props.shell.tabs.rename(item.id, title)
}

function run(item) { item.run?.() }
</script>

<template>
  <div class="bar">
    <div class="bar__start">
      <button
        v-for="item in state.start"
        :key="item.id"
        type="button"
        class="bar__chip hit"
        :class="{ 'is-on': state.page === 'home' && item.id === 'home' }"
        :title="item.title || item.label"
        @click="run(item)"
      >{{ item.label }}</button>
    </div>
    <div class="bar__tabs">
      <button
        v-for="item in state.tabs"
        :key="item.id"
        type="button"
        class="bar__tab hit"
        :class="{ 'is-on': current === item.id && state.page === 'session' }"
        @click="open(item.id)"
        @dblclick.stop="start(item)"
      >
        <input v-if="editing === item.id" v-model="draft" class="bar__rename" @blur="commit(item)" @keydown.enter="commit(item)" @click.stop>
        <span v-else class="bar__title">{{ item.title }}</span>
        <span class="bar__close hit" title="关闭标签" @click="close(item.id, $event)">×</span>
      </button>
      <button
        v-for="item in state.extras"
        :key="item.id"
        type="button"
        class="bar__plus hit"
        :title="item.title || item.label"
        @click="run(item)"
      >{{ item.label }}</button>
    </div>
    <div class="bar__end">
      <button
        v-for="item in state.end"
        :key="item.id"
        type="button"
        class="bar__chip hit"
        :class="{ 'is-on': state.page === 'settings' && item.id === 'settings' }"
        :title="item.title || item.label"
        @click="run(item)"
      >{{ item.label }}</button>
    </div>
  </div>
</template>

<style scoped>
.bar { display: flex; align-items: center; gap: 8px; min-height: 52px; padding: 6px 10px; background: var(--bg); border-bottom: 1px solid var(--line-soft); }
.bar__start, .bar__end { display: flex; gap: 6px; flex: none; }
.bar__tabs { display: flex; align-items: center; gap: 4px; min-width: 0; flex: 1; overflow-x: auto; scrollbar-width: none; }
.bar__tabs::-webkit-scrollbar { display: none; }
.bar__chip, .bar__plus, .bar__tab {
  flex: none; min-height: 40px; border: 0; background: transparent; color: var(--muted);
  font: inherit; font-size: 14px; cursor: pointer; border-radius: 999px; padding: 0 14px;
}
.bar__chip.is-on, .bar__tab.is-on { background: var(--soft-strong); color: var(--text); font-weight: 550; }
.bar__chip:hover, .bar__plus:hover, .bar__tab:hover { background: var(--hover); color: var(--text); }
.bar__plus { width: 40px; padding: 0; font-size: 20px; color: var(--text); }
.bar__tab { display: flex; align-items: center; gap: 2px; max-width: 200px; border-radius: 12px; padding: 0 6px 0 14px; }
.bar__title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar__rename { width: 120px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--text); font: inherit; font-size: 13px; padding: 4px 8px; }
.bar__close { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 999px; color: var(--faint); font-size: 18px; line-height: 1; }
.bar__close:hover { background: var(--soft-hover); color: var(--text); }
</style>
