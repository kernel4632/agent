<script setup>
import AppIcon from './AppIcon.vue'
const collapsed = defineModel('collapsed', { type: Boolean, default: false })
defineProps({ conversations: { type: Array, default: () => [] }, activeConversationId: String, activeView: String })
const emit = defineEmits(['home', 'new-conversation', 'select-conversation', 'settings', 'search'])
</script>

<template>
  <button v-if="!collapsed" class="sidebar-backdrop" aria-label="关闭导航" @click="collapsed = true"></button>
  <aside class="sidebar" :class="{ 'is-collapsed': collapsed }" aria-label="侧边栏">
    <header class="sidebar__brand">
      <button class="brand-button" aria-label="la 首页" @click="emit('home')"><span class="brand-mark">la<span></span></span><span v-if="!collapsed" class="brand-word">la<span>AGENT WORKSPACE</span></span></button>
      <button v-if="!collapsed" class="icon-button sidebar__toggle" aria-label="收起侧边栏" @click="collapsed = true"><AppIcon name="panel" :size="18" /></button>
    </header>
    <button v-if="collapsed" class="icon-button sidebar__expand" aria-label="展开侧边栏" @click="collapsed = false"><AppIcon name="panel" /></button>
    <button class="sidebar__new" aria-label="新建对话" @click="emit('new-conversation')"><AppIcon name="plus" /><span>新建对话</span><kbd>N</kbd></button>
    <nav class="sidebar__navigation" aria-label="主要导航">
      <button :class="{ active: activeView === 'home' }" aria-label="主页" :aria-current="activeView === 'home' ? 'page' : undefined" @click="emit('home')"><AppIcon name="home" /><span>工作台</span></button>
      <button aria-label="搜索会话" @click="emit('search')"><AppIcon name="search" /><span>搜索会话</span><kbd>Ctrl K</kbd></button>
    </nav>
    <div v-if="!collapsed" class="sidebar__history">
      <div class="sidebar__section-label"><span>最近对话</span><span>{{ conversations.length.toString().padStart(2, '0') }}</span></div>
      <div v-if="!conversations.length" class="sidebar__empty"><AppIcon name="chat" :size="25" /><p>新的灵感，从这里开始</p><span>你的对话会显示在这里</span></div>
      <button v-for="conversation in conversations.slice(0, 30)" :key="conversation.id" class="sidebar__conversation" :class="{ active: activeView === 'chat' && activeConversationId === conversation.id }" :title="conversation.title || '新对话'" @click="emit('select-conversation', conversation.id)">
        <AppIcon name="chat" :size="16" /><span>{{ conversation.title || '新对话' }}</span><i v-if="conversation.status === 'running'" class="status-dot"></i>
      </button>
    </div>
    <div class="sidebar__bottom">
      <div v-if="!collapsed" class="sidebar__local"><span class="status-dot"></span><span>本地优先，专注创造</span></div>
      <button class="sidebar__settings" :class="{ active: activeView === 'settings' }" aria-label="设置" @click="emit('settings')"><AppIcon name="settings" /><span>设置与偏好</span><AppIcon name="arrow" :size="15" /></button>
      <div v-if="!collapsed" class="sidebar__profile"><span class="profile-avatar"><AppIcon name="globe" :size="22" /></span><span>我的工作台<small>Personal workspace</small></span><span class="sidebar__version">v0.1</span></div>
    </div>
  </aside>
</template>

<style scoped lang="scss">
.sidebar { width: 254px; flex: 0 0 254px; height: 100%; display: flex; flex-direction: column; padding: 24px 16px 16px; background: var(--la-sidebar); border-right: 1px solid var(--la-line); z-index: 30; transition: width .2s, flex-basis .2s; }
.sidebar__brand { display: flex; align-items: center; justify-content: space-between; margin: 0 2px 30px; }
.brand-button { display: flex; align-items: center; gap: 11px; border: 0; background: none; text-align: left; padding: 0; color: var(--la-text); cursor: pointer; }
.brand-word { font-size: 24px; font-weight: 650; line-height: 1; letter-spacing: -1px; }
.brand-word > span { display: block; font-size: 8px; letter-spacing: 1.5px; font-weight: 500; margin-top: 8px; color: var(--la-muted); }
.sidebar__toggle { color: var(--la-muted); }
.sidebar__new { display: flex; align-items: center; gap: 11px; width: 100%; min-height: 44px; padding: 0 13px; color: var(--la-accent); background: var(--la-accent-soft); border: 1px solid var(--la-accent-border); border-radius: 10px; cursor: pointer; font-weight: 550; }
kbd { margin-left: auto; font: 10px/1.6 inherit; opacity: .55; white-space: nowrap; border: 1px solid var(--la-line); padding: 1px 4px; border-radius: 4px; }
.sidebar__navigation { display: grid; gap: 5px; margin: 20px 0 28px; }
.sidebar__navigation button, .sidebar__settings { display: flex; width: 100%; align-items: center; gap: 12px; padding: 11px 13px; border: 0; border-radius: 9px; background: transparent; color: var(--la-secondary); text-align: left; cursor: pointer; font-size: 13px; }
.sidebar__navigation button:hover, .sidebar__settings:hover, .sidebar__conversation:hover { background: var(--la-hover); color: var(--la-text); }
.sidebar__navigation button.active, .sidebar__settings.active { background: var(--la-hover); color: var(--la-text); }
.sidebar__history { flex: 1; min-height: 0; overflow-y: auto; }
.sidebar__section-label { display: flex; justify-content: space-between; padding: 0 13px 12px; font-size: 11px; color: var(--la-muted); letter-spacing: .3px; }
.sidebar__conversation { display: flex; align-items: center; gap: 10px; width: 100%; padding: 12px 13px; border: 0; border-radius: 8px; background: none; text-align: left; color: var(--la-secondary); cursor: pointer; }
.sidebar__conversation svg { flex-shrink: 0; opacity: .7; }
.sidebar__conversation > span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 12px; }
.sidebar__conversation.active { color: var(--la-accent); background: var(--la-accent-soft); }
.sidebar__empty { padding: 40px 8px; text-align: center; color: var(--la-muted); }
.sidebar__empty > svg { opacity: .5; }
.sidebar__empty p { font-size: 12px; margin: 14px 0 8px; color: var(--la-secondary); }
.sidebar__empty > span { font-size: 11px; }
.sidebar__bottom { margin-top: auto; padding-top: 18px; }
.sidebar__local { display: flex; align-items: center; gap: 8px; margin: 0 13px 18px; font-size: 10px; color: var(--la-muted); }
.sidebar__settings > svg:last-child { margin-left: auto; }
.sidebar__profile { display: flex; align-items: center; gap: 10px; border-top: 1px solid var(--la-line); margin-top: 14px; padding: 18px 6px 0; font-size: 12px; }
.sidebar__profile small { display: block; color: var(--la-muted); font-size: 10px; margin-top: 4px; }
.profile-avatar { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: linear-gradient(140deg, #a5cee5, #314877); color: #e1f1ff; }
.sidebar__version { margin-left: auto; color: var(--la-muted); font-size: 10px; }
.sidebar__expand { margin: -10px auto 18px; }
.sidebar-backdrop { display: none; }
.is-collapsed { width: 76px; flex-basis: 76px; padding-inline: 12px; }
.is-collapsed .sidebar__brand { justify-content: center; margin-bottom: 28px; }
.is-collapsed .sidebar__new, .is-collapsed .sidebar__navigation button, .is-collapsed .sidebar__settings { justify-content: center; padding-inline: 0; }
.is-collapsed .sidebar__new span, .is-collapsed kbd, .is-collapsed .sidebar__navigation span, .is-collapsed .sidebar__settings span, .is-collapsed .sidebar__settings > svg:last-child { display: none; }
@media (max-width: 760px) {
  .sidebar { position: fixed; inset: 0 auto 0 0; width: 270px; }
  .sidebar.is-collapsed { transform: translateX(-100%); width: 270px; pointer-events: none; visibility: hidden; }
  .sidebar-backdrop { display: block; position: fixed; inset: 0; z-index: 29; border: 0; background: #0009; backdrop-filter: blur(3px); }
}
</style>
