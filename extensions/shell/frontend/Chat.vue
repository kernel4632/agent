<!--
对话页在标签栏下面还有一条顶栏：左边是当前会话标题，右边是扩展登记的动作（任务清单，以后的审计），都是 32px 圆形图标钮。
带 component 的动作在对话右侧打开一块面板；对话区窄于 760px 时（手机）面板改成盖住对话的整屏页，顶上有返回。
宽窄按容器宽度切（container query），不区分触摸和鼠标。
-->
<script setup>
import { computed } from 'vue'
import { ArrowLeft01Icon, Cancel01Icon } from '@hugeicons/core-free-icons'
import { state } from './state.js'

const props = defineProps({
    shell: { type: Object, required: true },
    original: { type: Object, required: true },
    app: { type: Object, required: true },
})

const Icon = props.app.shared.Components.Icon
/** @type {import('vue').ComputedRef<import('agent-extension').ShellHeaderItem | null>} */
const side = computed(() => state.header.find(item => item.id === state.side && item.component) ?? null)
const title = computed(() => state.tabs.find(item => item.id === state.session)?.title || state.title || '会话')

/** @param {import('agent-extension').ShellHeaderItem} item */
function act(item) {
    if (item.component) props.shell.header.toggle(item.id)
    else item.run?.()
}
</script>

<template>
  <div class="chat">
    <header class="chat__head">
      <h1 class="chat__title" :title="title">{{ title }}</h1>
      <div class="chat__actions">
        <button
          v-for="item in state.header" :key="item.id" type="button" class="chat__round hit"
          :class="{ 'is-on': state.side === item.id }" :title="item.title || item.label"
          :aria-label="item.title || item.label" :aria-pressed="state.side === item.id" @click="act(item)"
        ><Icon v-if="item.icon" :icon="item.icon" :size="18" /><span v-else>{{ item.label }}</span></button>
      </div>
    </header>
    <div class="chat__body">
      <div class="chat__main"><component :is="original" /></div>
      <aside v-if="side" class="chat__side" :aria-label="side.title || side.label">
        <header class="chat__side-head">
          <button type="button" class="chat__round chat__back hit" aria-label="返回对话" @click="shell.header.toggle(side.id)">
            <Icon :icon="ArrowLeft01Icon" :size="18" />
          </button>
          <h2>{{ side.title || side.label }}</h2>
          <button type="button" class="chat__round chat__close hit" aria-label="关闭面板" title="关闭" @click="shell.header.toggle(side.id)">
            <Icon :icon="Cancel01Icon" :size="16" />
          </button>
        </header>
        <div class="chat__side-body"><component :is="side.component" :app="app" :api="app.api" /></div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.chat { display: flex; flex-direction: column; height: 100%; min-height: 0; container: chat / inline-size; }
.chat__head { display: flex; align-items: center; gap: 12px; height: 52px; padding: 0 20px 0 24px; }
.chat__title { flex: 1; min-width: 0; margin: 0; font-size: 15px; font-weight: 550; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat__actions { display: flex; gap: 8px; flex: none; }
.chat__round {
  display: grid; place-items: center; flex: none; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 50%;
  background: transparent; color: var(--muted); font: inherit; font-size: 13px; cursor: pointer;
}
.chat__round:hover { background: var(--hover); color: var(--text); }
.chat__round.is-on { background: var(--soft-strong); color: var(--text); }
.chat__body { position: relative; display: flex; flex: 1; min-height: 0; }
.chat__main { position: relative; flex: 1; min-width: 0; }
.chat__side { display: flex; flex-direction: column; flex: none; width: 360px; border-left: 1px solid var(--line-soft); background: var(--bg); }
.chat__side-head { display: flex; align-items: center; gap: 8px; height: 52px; padding: 0 12px 0 20px; }
.chat__side-head h2 { flex: 1; margin: 0; font-size: 15px; font-weight: 550; }
.chat__back { display: none; }
.chat__side-body { flex: 1; overflow: auto; padding: 4px 20px 24px; }
@container chat (max-width: 760px) {
  .chat__head { padding: 0 12px 0 16px; }
  .chat__side { position: absolute; inset: 0; z-index: 40; width: auto; border-left: 0; }
  .chat__side-head { padding: 0 12px 0 8px; }
  .chat__back { display: grid; }
  .chat__close { display: none; }
  .chat__side-body { padding: 4px 16px 24px; }
}
</style>
