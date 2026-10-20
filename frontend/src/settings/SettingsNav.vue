<!--
设置导航：展示“返回应用”、设置标题和按 group 分组的页面入口，只读传入的页面登记表。
不持有页面数据；点击可用项发出 select，返回按钮发出 back，由设置页决定切换和关闭。
调用示例：<SettingsNav :pages="settingsPages" :active-id="selected" @select="selectPage" @back="UI.closeSettings()" />。
-->
<script setup>
import { computed } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import Button from '../ui/Button.vue'
import { groupSettingsPages } from './pages.js'

const props = defineProps({
  pages: { type: Array, required: true },                  // 设置页登记表，导航按其中的 group 分组
  activeId: { type: String, default: 'appearance' },       // 当前页面 id，用于高亮和 aria-current
})
const emit = defineEmits(['select', 'back'])

// 分组只由登记表决定；新增页面落到哪个 group，导航就自动出现对应分组。
const groups = computed(() => groupSettingsPages(props.pages))

function selectPage(page) {
  if (!page.disabled) emit('select', page.id)
}
</script>

<template>
  <aside class="settings-nav">
    <Button variant="plain" class="settings-back" @click="emit('back')"><AppIcon name="arrow" :size="14" class="settings-back-icon" />返回应用</Button>
    <h2>设置</h2>
    <nav aria-label="设置分类">
      <section v-for="group in groups" :key="group.label" class="settings-nav-group">
        <div class="settings-nav-group__label">{{ group.label }}</div>
        <Button v-for="item in group.items" :key="item.id" variant="plain" :class="{ active: activeId === item.id }" :disabled="item.disabled" :title="item.disabled ? '暂不支持此管理功能' : item.label" :aria-current="activeId === item.id ? 'page' : undefined" @click="selectPage(item)">
          <AppIcon :name="item.icon" :size="16" /><span>{{ item.label }}</span><small v-if="item.disabled">待支持</small>
        </Button>
      </section>
    </nav>
  </aside>
</template>

<style scoped lang="scss">
.settings-nav {
  display: flex;
  width: 328px;
  min-width: 328px;
  flex: 0 0 328px;
  flex-direction: column;
  gap: 16px;
  padding: 48px 64px 48px 24px;
}
.settings-back {
  display: flex;
  height: 28px;
  align-items: center;
  gap: 6px;
  padding: 0 6px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--la-muted);
  text-align: left;
  font-size: 13px;
  cursor: pointer;
}
.settings-back:hover { background: var(--la-layer-03); color: var(--la-text); }
.settings-back-icon { transform: rotate(180deg); }
.settings-nav h2 { margin: 0 6px; color: var(--la-text); font-size: 15px; font-weight: 640; line-height: 20px; }
.settings-nav nav { display: flex; flex-direction: column; gap: 16px; }
.settings-nav-group { display: flex; flex-direction: column; gap: 4px; }
.settings-nav-group__label { display: flex; height: 28px; align-items: center; padding: 0 6px; color: var(--la-muted); font-size: 13px; font-weight: 440; }
.settings-nav nav button {
  display: flex;
  width: 100%;
  height: 28px;
  align-items: center;
  gap: 6px;
  padding: 0 6px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--la-muted);
  text-align: left;
  font-size: 13px;
  font-weight: 440;
  cursor: pointer;
}
.settings-nav nav button.active { background: var(--la-layer-03); color: var(--la-text); }
.settings-nav nav button:hover:not(:disabled) { background: var(--la-hover); }
.settings-nav small { margin-left: auto; color: var(--la-muted); font-size: 11px; }
@media (max-width: 1047px) {
  .settings-nav { width: 240px; min-width: 240px; flex-basis: 240px; padding-left: 16px; padding-right: 24px; }
}
@media (max-width: 799px) {
  .settings-nav { width: 100%; min-width: 0; flex: none; gap: 4px; padding: 8px 12px; border-bottom: .5px solid var(--la-line); }
  .settings-back { display: none; }
  .settings-nav h2 { display: none; }
  .settings-nav nav { flex-direction: row; gap: 2px; overflow-x: auto; }
  .settings-nav-group { display: contents; }
  .settings-nav-group__label { display: none; }
  .settings-nav nav button { width: auto; flex: none; padding: 0 8px; white-space: nowrap; }
  .settings-nav nav button:disabled { display: none; }
}
</style>
