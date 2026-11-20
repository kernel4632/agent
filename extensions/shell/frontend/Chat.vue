<!--
对话页在标签栏下面还有一条顶栏：左边是当前会话标题，右边是扩展登记的动作（任务清单，以后的审计）。
点带 component 的动作会在对话右侧打开一块侧栏，不盖住顶上的标签。
-->
<script setup>
import { computed } from 'vue'
import { state } from './state.js'

const props = defineProps({
    shell: { type: Object, required: true },
    original: { type: Object, required: true },
    app: { type: Object, required: true },
})

const side = computed(() => state.header.find(item => item.id === state.side && item.component) ?? null)
const title = computed(() => state.tabs.find(item => item.id === state.session)?.title || state.title || '会话')

function act(item) {
    if (item.component) props.shell.header.toggle(item.id)
    else item.run?.()
}
</script>

<template>
  <div class="chat">
    <header class="chat__head">
      <h1 class="chat__title">{{ title }}</h1>
      <div class="chat__actions">
        <button
          v-for="item in state.header"
          :key="item.id"
          type="button"
          class="chat__action hit"
          :class="{ 'is-on': state.side === item.id }"
          :title="item.title || item.label"
          @click="act(item)"
        >{{ item.label }}</button>
      </div>
    </header>
    <div class="chat__body">
      <div class="chat__main">
        <component :is="original" />
      </div>
      <aside v-if="side" class="chat__side">
        <header class="chat__side-head">
          <h2>{{ side.title || side.label }}</h2>
          <button type="button" class="hit" @click="shell.header.toggle(side.id)">关闭</button>
        </header>
        <div class="chat__side-body">
          <component :is="side.component" :app="app" :api="app.api" />
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.chat { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.chat__head { display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 0 16px; border-bottom: 1px solid var(--line-soft); background: var(--bg); }
.chat__title { margin: 0; min-width: 0; flex: 1; font-size: 16px; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat__actions { display: flex; gap: 4px; flex: none; }
.chat__action {
  min-height: 40px; padding: 0 14px; border: 0; border-radius: 999px;
  background: transparent; color: var(--muted); font: inherit; font-size: 14px; cursor: pointer;
}
.chat__action:hover, .chat__action.is-on { background: var(--hover); color: var(--text); }
.chat__action.is-on { background: var(--soft-strong); }
.chat__body { display: flex; min-height: 0; flex: 1; position: relative; }
.chat__main { flex: 1; min-width: 0; position: relative; }
.chat__side { flex: none; width: min(360px, 92vw); border-left: 1px solid var(--line); background: var(--pane); display: flex; flex-direction: column; }
.chat__side-head { display: flex; align-items: center; justify-content: space-between; min-height: 52px; padding: 0 16px; border-bottom: 1px solid var(--line-soft); }
.chat__side-head h2 { margin: 0; font-size: 15px; font-weight: 550; }
.chat__side-head button { border: 0; background: transparent; color: var(--muted); font: inherit; min-height: 40px; padding: 0 10px; cursor: pointer; border-radius: 999px; }
.chat__side-body { overflow: auto; padding: 12px 16px; flex: 1; }
</style>
