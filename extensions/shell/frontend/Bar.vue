<!--
最顶上一栏：左边是入口图标（会话主页），中间是已打开的会话标签（像浏览器），标签后面是 +，右边是设置。
入口和 + 都由别的扩展用 shell.bar.add 登记，带 icon 就画成 32px 圆钮（.hit 补到 ≥40px），否则显示文字。
标签是软胶囊：点选、双击改名、× 从条上拿掉（会话本身还在列表里）。标签多了就横向滚动，+ 和两侧入口始终露在外面。
-->
<script setup>
import { nextTick, ref } from 'vue'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { state } from './state.js'

const props = defineProps({ shell: { type: Object, required: true }, app: { type: Object, required: true } })
const Icon = props.app.shared.Components.Icon
const editing = ref('')
const draft = ref('')
/** @type {import('vue').Ref<Array<HTMLInputElement> | null>} */
const input = ref(null)

/** @param {string} id */
function close(id) { props.shell.tabs.close(id) }
/** @param {{ id: string, title: string }} item */
async function start(item) {
    editing.value = item.id
    draft.value = item.title
    await nextTick()
    input.value?.[0]?.select()
}
/** @param {{ id: string, title: string }} item */
function commit(item) {
    const title = draft.value.trim()
    editing.value = ''
    if (title && title !== item.title) props.shell.tabs.rename(item.id, title)
}
/** @param {{ id: string }} item */
const on = item => (item.id === 'home' && state.page === 'home') || (item.id === state.page)
</script>

<template>
  <nav class="bar" aria-label="已打开的会话">
    <button
      v-for="item in state.start" :key="item.id" type="button" class="bar__round hit"
      :class="{ 'is-on': on(item) }" :title="item.title || item.label" :aria-label="item.title || item.label" @click="item.run?.()"
    ><Icon v-if="item.icon" :icon="item.icon" :size="18" /><span v-else>{{ item.label }}</span></button>

    <div class="bar__tabs" role="tablist">
      <div
        v-for="item in state.tabs" :key="item.id" class="bar__tab" role="tab"
        :class="{ 'is-on': state.page === 'session' && state.session === item.id }"
        :aria-selected="state.page === 'session' && state.session === item.id"
        :title="item.title" @click="shell.tabs.open(item.id)" @dblclick="start(item)"
      >
        <input v-if="editing === item.id" ref="input" v-model="draft" class="bar__rename" aria-label="标签标题"
          @blur="commit(item)" @keydown.enter="commit(item)" @keydown.esc="editing = ''" @click.stop>
        <span v-else class="bar__title">{{ item.title }}</span>
        <button type="button" class="bar__close hit" aria-label="关闭标签" title="关闭标签" @click.stop="close(item.id)">
          <Icon :icon="Cancel01Icon" :size="14" />
        </button>
      </div>
    </div>
    <button
      v-for="item in state.extras" :key="item.id" type="button" class="bar__round bar__round--soft hit"
      :title="item.title || item.label" :aria-label="item.title || item.label" @click="item.run?.()"
    ><Icon v-if="item.icon" :icon="item.icon" :size="18" /><span v-else>{{ item.label }}</span></button>
    <span class="bar__gap"></span>

    <button
      v-for="item in state.end" :key="item.id" type="button" class="bar__round hit"
      :class="{ 'is-on': on(item) }" :title="item.title || item.label" :aria-label="item.title || item.label" @click="item.run?.()"
    ><Icon v-if="item.icon" :icon="item.icon" :size="18" /><span v-else>{{ item.label }}</span></button>
  </nav>
</template>

<style scoped>
.bar { display: flex; align-items: center; gap: 8px; height: 56px; padding: 0 12px; background: var(--bg); border-bottom: 1px solid var(--line-soft); }
.bar__round {
  display: grid; place-items: center; flex: none; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 50%;
  background: transparent; color: var(--muted); font: inherit; font-size: 13px; cursor: pointer;
}
.bar__round:hover { background: var(--hover); color: var(--text); }
.bar__round.is-on { background: var(--soft-strong); color: var(--text); }
.bar__round--soft { background: var(--soft-strong); color: var(--text); }
.bar__round--soft:hover { background: var(--soft-hover); }
.bar__tabs {
  display: flex; align-items: center; gap: 4px; flex: 0 1 auto; min-width: 0; height: 100%; padding: 0 4px;
  overflow-x: auto; scrollbar-width: none; overscroll-behavior-x: contain;
  mask-image: linear-gradient(to right, transparent, #000 8px, #000 calc(100% - 8px), transparent);
}
.bar__tabs::-webkit-scrollbar { display: none; }
.bar__gap { flex: 1; min-width: 0; }
.bar__tab {
  display: flex; align-items: center; gap: 4px; flex: none; height: 36px; max-width: 200px; padding: 0 6px 0 14px;
  border-radius: 999px; color: var(--muted); font-size: 13.5px; cursor: pointer; user-select: none;
}
.bar__tab:hover { background: var(--hover); color: var(--text); }
.bar__tab.is-on { background: var(--soft-strong); color: var(--text); font-weight: 550; }
.bar__title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar__rename { width: 128px; height: 26px; padding: 0 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--text); font: inherit; }
.bar__close {
  display: grid; place-items: center; flex: none; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 50%;
  background: transparent; color: var(--faint); cursor: pointer;
}
.bar__close:hover { background: var(--soft-hover); color: var(--text); }
@media (max-width: 640px) {
  .bar { gap: 4px; padding: 0 8px; height: 52px; }
  .bar__tab { max-width: 148px; padding-left: 12px; }
}
</style>
