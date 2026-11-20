<!--
设置和其他扩展登记的面板宿主：从右侧滑出。openPanel 挂在 app.shared 上。
-->
<script setup>
import { computed } from 'vue'

const props = defineProps({
    app: { type: Object, required: true },
    original: { type: Object, required: true },
})

const current = computed(() => (props.app.shared.Panels ?? []).find(item => item.id === props.app.shared.panel?.value) ?? null)
function close() { if (props.app.shared.panel) props.app.shared.panel.value = '' }
</script>

<template>
  <div class="host">
    <component :is="original" />
    <aside v-if="current" class="host__panel">
      <header class="host__head">
        <h2>{{ current.title }}</h2>
        <button type="button" @click="close">关闭</button>
      </header>
      <div class="host__body">
        <component :is="current.component" :api="app.api" :app="app" />
      </div>
    </aside>
  </div>
</template>

<style scoped>
.host { position: relative; height: 100%; }
.host__panel {
  position: absolute; top: 0; right: 0; bottom: 0; width: min(420px, 100vw);
  background: var(--pane); border-left: 1px solid var(--line); z-index: 20;
  display: flex; flex-direction: column; box-shadow: -8px 0 24px rgba(0,0,0,.04);
}
.host__head { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid var(--line-soft); }
.host__head h2 { margin: 0; font-size: 16px; font-weight: 550; }
.host__head button { border: 0; background: transparent; color: var(--muted); font: inherit; cursor: pointer; }
.host__body { overflow: auto; padding: 12px 18px; flex: 1; }
</style>
