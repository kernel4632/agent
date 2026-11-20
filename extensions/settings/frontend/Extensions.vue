<!--
扩展：照旧前端 ExtensionList，一张分组卡片里每个扩展一行（拼图图标、名字和版本、说明、状态），右边是开关。
关掉一个扩展时，依赖它的扩展会被加载器一起停掉；前端界面的增减要刷新页面才完全生效，所以开关后给出刷新提示。
-->
<script setup>
import { computed, onMounted, ref } from 'vue'
import { PuzzleIcon, RefreshIcon } from '@hugeicons/core-free-icons'

const props = defineProps({ api: { type: Object, required: true }, ui: { type: Object, required: true } })
const ui = props.ui
const Icon = ui.Icon
const items = ref([])
const busy = ref('')
const changed = ref(false)

async function load() { items.value = await props.api.op('settings.extensions') }
async function toggle(item, enabled) {
    busy.value = item.name
    try {
        await props.api.op('settings.toggle', { name: item.name, enabled })
        changed.value = true
        await load()
    } finally { busy.value = '' }
}

const off = item => item.error === '已关闭'
// 关掉壳或设置页后就没有入口再打开它们，所以这两个在这里锁住，要关请改 config.json。
const locked = item => item.name === 'shell' || item.name === 'settings'
const state = item => off(item) ? '已关闭' : item.error ? item.error : `${item.version ? `v${item.version} · ` : ''}运行中`
const sorted = computed(() => [...items.value].sort((a, b) => a.name.localeCompare(b.name)))

function reload() { location.reload() }

onMounted(load)
</script>

<template>
  <p class="ui-hint">扩展放在项目的 extensions/ 或 ~/.agents/extensions/ 里。内置扩展也能关掉或替换。</p>
  <div v-if="changed" class="ext__reload">
    <span>界面类扩展的变化要刷新页面后才完整生效。</span>
    <button type="button" class="ui-btn" @click="reload"><Icon :icon="RefreshIcon" :size="16" />刷新</button>
  </div>
  <ui.List>
    <ui.Row
      v-for="item in sorted" :key="item.name" :icon="PuzzleIcon" :tone="off(item) ? '' : item.error ? 'warn' : 'success'"
      :title="item.name" :description="[item.description, state(item)].filter(Boolean).join(' · ')"
    >
      <ui.Switch :model-value="!off(item)" :disabled="busy === item.name || locked(item)" :label="`启用 ${item.name}`" @update:model-value="toggle(item, $event)" />
    </ui.Row>
  </ui.List>
</template>

<style scoped>
.ext__reload { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; padding: 10px 10px 10px 16px; border-radius: 16px; background: color-mix(in srgb, var(--accent) 10%, transparent); font-size: 13px; }
</style>
