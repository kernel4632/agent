<!--
顶部外壳：频道徽标、主页、会话标签、命令面板和设置入口。
标签标题优先取已读取的会话，头像色由标签 key 计算；App 只处理这里发出的事件。
调用示例：<Titlebar :mode="mode" @home="goHome" @new="openDraft" @select="openTab" @close="closeTab" @palette="openPalette" @settings="UI.openSettings()" />
-->
<script setup>
import { computed } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import IconButton from '../ui/IconButton.vue'
import TabStrip from './TabStrip.vue'
import { store } from '../store.js'

defineProps({
  mode: { type: String, default: 'home' },              // home、draft、session 或 settings
})

const emit = defineEmits(['home', 'new', 'select', 'close', 'palette', 'settings'])

// 标签头像色：同一个 key 永远得到同一种颜色，刷新后也不会变。
const tabPalette = ['#3250df', '#2eaf5a', '#ee7330', '#e4429e', '#623be2', '#0096b8']
function tabColor(key) {
  let value = 0
  for (const char of key) value = (value * 31 + char.charCodeAt(0)) >>> 0
  return tabPalette[value % tabPalette.length]
}

// 会话读取后标题可能更新；还没读取到完整会话时沿用标签创建时的标题。
const tabs = computed(() => store.tabs.items.map(tab => {
  const title = store.sessions[tab.sessionID]?.title || tab.title || '新会话'
  return { ...tab, title, color: tabColor(tab.key) }
}))
</script>

<template>
  <header class="titlebar">
    <span class="titlebar__channel" aria-hidden="true">la</span>
    <IconButton label="主页" :active="mode === 'home'" @click="emit('home')"><AppIcon name="grid-plus" :size="16" /></IconButton>
    <TabStrip :tabs="tabs" :active-key="store.tabs.activeKey" @select="emit('select', $event)" @close="emit('close', $event)" @new="emit('new')" />
    <div class="titlebar__right">
      <IconButton label="命令面板" title="命令面板 (Ctrl K)" @click="emit('palette')"><AppIcon name="search" :size="15" /></IconButton>
      <IconButton label="设置" title="设置" @click="emit('settings')"><AppIcon name="settings" :size="16" /></IconButton>
    </div>
  </header>
</template>

<style scoped lang="scss">
.titlebar {
  display: flex;
  flex: 0 0 var(--la-titlebar-height);
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  background: var(--la-bg);
  user-select: none;
}
.titlebar__channel {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  border-radius: 4px;
  background: var(--la-accent-solid);
  color: #fff;
  box-shadow: var(--la-shadow-raised);
  font: 600 8px/1 var(--la-font-mono);
  letter-spacing: .02em;
}
.titlebar__right { display: flex; align-items: center; gap: 2px; margin-left: 2px; }
@media (max-width: 767px) {
  .titlebar { padding: 0 6px; }
  .titlebar__channel { display: none; }
}
</style>
