<script setup>
import { computed, nextTick, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { UI } from '../commands/ui.js'
import { Session } from '../commands/session.js'
const collapsed = defineModel('collapsed', { type: Boolean, default: false })
const props = defineProps({ conversations: { type: Array, default: () => [] }, activeConversationId: String, activeView: String })
const emit = defineEmits(['home', 'new-conversation', 'select-conversation', 'settings', 'search'])
const searchOpen = ref(false)
const search = ref('')
const searchInput = ref(null)
const dialog = ref(null)
const mode = ref('open')
const target = ref(null)
const value = ref('')
const busy = ref(false)
const visibleConversations = computed(() => props.conversations.filter(item => (item.title || '').toLowerCase().includes(search.value.trim().toLowerCase())))

async function focusSearch() {
  searchOpen.value = true
  collapsed.value = false
  await nextTick()
  searchInput.value?.focus()
}

defineExpose({ focusSearch })

function openDialog(kind, item) {
  mode.value = kind
  target.value = item
  value.value = kind === 'rename' ? item.title : ''
  dialog.value.showModal()
}

async function submitDialog() {
  if (busy.value) return
  busy.value = true
  try {
    const ok = mode.value === 'rename' ? await Session.rename(target.value.id, value.value)
      : mode.value === 'delete' ? await Session.remove(target.value.id) : await Session.openByID(value.value)
    if (ok) dialog.value.close()
  } finally { busy.value = false }
}
</script>

<template>
  <button v-if="!collapsed" class="sidebar-backdrop" aria-label="关闭导航" @click="collapsed = true"></button>
  <aside class="sidebar" :class="{ 'is-collapsed': collapsed }" aria-label="侧边栏">
    <header class="sidebar__brand">
       <button class="brand-button" aria-label="主页" @click="emit('new-conversation')"><span class="avatar avatar--user"><AppIcon name="globe" :size="20" /></span><span v-if="!collapsed" class="brand-word">我的空间<small>本地工作区</small></span></button>
      <button v-if="!collapsed" class="icon-button sidebar__toggle" aria-label="收起侧边栏" @click="collapsed = true"><AppIcon name="panel" :size="18" /></button>
    </header>
    <button v-if="collapsed" class="icon-button sidebar__expand" aria-label="展开侧边栏" @click="collapsed = false"><AppIcon name="panel" /></button>
    <button class="sidebar__new" aria-label="新建对话" @click="emit('new-conversation')"><AppIcon name="plus" /><span>新建对话</span><kbd>N</kbd></button>
    <nav class="sidebar__navigation" aria-label="主要导航">
       <button aria-label="搜索会话" @click="focusSearch"><AppIcon name="search" /><span>搜索会话</span><kbd>Ctrl K</kbd></button>
     </nav>
     <label v-if="searchOpen && !collapsed" class="sidebar__search"><AppIcon name="search" :size="15" /><input id="home-search" ref="searchInput" v-model="search" type="search" aria-label="搜索会话" placeholder="搜索会话" /><button type="button" aria-label="关闭搜索" @click="searchOpen = false; search = ''"><AppIcon name="close" :size="13" /></button></label>
     <div v-if="!collapsed" class="sidebar__history">
       <div class="sidebar__section-label"><span>对话</span><button class="icon-button" aria-label="通过 ID 打开" title="通过 ID 打开已有会话" @click="openDialog('open')"><AppIcon name="link" :size="14" /></button></div>
       <div v-if="search && !visibleConversations.length" class="sidebar__empty sidebar__empty--search"><p>没有找到相关会话</p><button class="text-button" @click="search = ''">清除搜索</button></div>
       <div v-else-if="!conversations.length" class="sidebar__empty"><AppIcon name="chat" :size="25" /><p>新的对话，从这里开始</p><span>你的会话会显示在这里</span></div>
       <div v-for="conversation in visibleConversations" :key="conversation.id" class="session-row" :class="{ active: activeConversationId === conversation.id }">
         <button class="sidebar__conversation" :title="conversation.title || '新对话'" @click="Session.open(conversation.id)"><span>{{ conversation.title || '新对话' }}</span><i v-if="conversation.status === 'running'" class="status-dot"></i></button>
         <div class="session-row__actions">
           <button class="icon-button" :aria-label="`重命名 ${conversation.title}`" @click="openDialog('rename', conversation)"><AppIcon name="edit" :size="13" /></button>
           <button class="icon-button" :aria-label="`删除 ${conversation.title}`" @click="openDialog('delete', conversation)"><AppIcon name="trash" :size="13" /></button>
         </div>
       </div>
    </div>
    <div class="sidebar__bottom">
       <div v-if="!collapsed" class="sidebar__assistant"><span class="avatar avatar--assistant"><AppIcon name="spark" :size="16" /></span><span>la<small>你的 AI 助手</small></span><span class="status-dot"></span></div>
       <button class="sidebar__settings" aria-label="设置" @click="UI.openSettings()"><AppIcon name="settings" :size="18" /><span>设置</span><span class="sidebar__version">v0.1</span></button>
     </div>
   </aside>
   <dialog ref="dialog" class="dialog" :aria-label="mode === 'delete' ? '删除会话' : mode === 'rename' ? '重命名会话' : '打开已有会话'" @cancel="busy && $event.preventDefault()">
     <form @submit.prevent="submitDialog">
       <h2>{{ mode === 'delete' ? '删除这段对话？' : mode === 'rename' ? '重命名会话' : '打开已有会话' }}</h2>
       <p>{{ mode === 'delete' ? '会话和历史记录将从服务器永久删除，无法恢复。' : mode === 'rename' ? '为这段对话设置一个名称。' : '输入会话 ID，将已有会话加入本机列表。' }}</p>
       <label v-if="mode !== 'delete'">{{ mode === 'rename' ? '会话名称' : '会话 ID' }}<input v-model="value" class="field" required :maxlength="mode === 'rename' ? 120 : 100" /></label>
       <div class="dialog-actions"><button type="button" class="button" :disabled="busy" @click="dialog.close()">取消</button><button class="button button--primary" :disabled="busy">{{ mode === 'delete' ? '确认删除' : mode === 'rename' ? '保存名称' : '打开会话' }}</button></div>
     </form>
   </dialog>
</template>

<style scoped lang="scss">
.sidebar {
  width: var(--la-sidebar-width); flex: 0 0 var(--la-sidebar-width); height: 100%;
  display: flex; flex-direction: column; padding: 12px 8px 8px;
  background: var(--la-sidebar); border-right: 1px solid var(--la-line);
  z-index: 30; transition: width .18s ease, flex-basis .18s ease;
}
.sidebar__brand { display: flex; align-items: center; justify-content: space-between; min-height: 28px; margin: 0 4px 16px; }
.brand-button { display: flex; align-items: center; gap: 10px; padding: 0; border: 0; background: none; color: var(--la-text); text-align: left; cursor: pointer; }
.brand-word { font-size: 13px; font-weight: 550; line-height: 1; }
.brand-word small { display: block; margin-top: 4px; color: var(--la-muted); font-size: 10px; font-weight: 400; }
.sidebar__toggle { width: 26px; height: 26px; color: var(--la-muted); }
.sidebar__new { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 32px; padding: 0 9px; border: 1px solid transparent; border-radius: var(--la-radius); background: transparent; color: var(--la-secondary); font-size: 12px; font-weight: 400; cursor: pointer; }
.sidebar__new:hover { background: var(--la-hover); color: var(--la-text); }
kbd { margin-left: auto; color: var(--la-muted); font: 10px/1.6 var(--la-font-mono); white-space: nowrap; }
.sidebar__navigation { display: grid; gap: 2px; margin: 2px 0 18px; }
.sidebar__navigation button, .sidebar__settings { display: flex; width: 100%; min-height: 30px; align-items: center; gap: 9px; padding: 0 9px; border: 0; border-radius: var(--la-radius); background: transparent; color: var(--la-secondary); text-align: left; font-size: 12px; cursor: pointer; }
.sidebar__navigation button:hover, .sidebar__settings:hover, .sidebar__conversation:hover { background: var(--la-hover); color: var(--la-text); }
.sidebar__navigation button.active, .sidebar__settings.active { background: var(--la-hover); color: var(--la-text); }
.sidebar__history { flex: 1; min-height: 0; overflow-y: auto; }
.sidebar__section-label { display: flex; align-items: center; justify-content: space-between; padding: 8px 9px 5px; color: var(--la-muted); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
.sidebar__conversation { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 30px; padding: 0 9px; border: 0; border-radius: var(--la-radius); background: none; color: var(--la-secondary); text-align: left; cursor: pointer; }
.sidebar__conversation svg { flex-shrink: 0; opacity: .7; }
.sidebar__conversation > span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 12px; }
.sidebar__empty { padding: 14px 9px; color: var(--la-muted); }
.sidebar__empty > svg { display: none; }
.sidebar__empty p { margin: 8px 0 6px; color: var(--la-secondary); font-size: 12px; }
.sidebar__empty > span { font-size: 11px; }
.sidebar__bottom { margin-top: auto; padding-top: 10px; border-top: 1px solid var(--la-line); }
.sidebar__local { display: flex; align-items: center; gap: 8px; margin: 0 9px 10px; color: var(--la-muted); font-size: 10px; }
.sidebar__assistant { display: flex; align-items: center; gap: 9px; margin: 0 8px 8px; font-size: 12px; }
.sidebar__assistant small { display: block; margin-top: 3px; color: var(--la-muted); font-size: 10px; }
.sidebar__assistant > .status-dot { margin-left: auto; }
.sidebar__version { margin-left: auto; color: var(--la-muted); font-size: 10px; }
.sidebar__expand { margin: -8px auto 14px; }
.sidebar-backdrop { display: none; }
.sidebar__search {
  display: flex; align-items: center; gap: 6px; min-height: 32px; margin-bottom: 8px; padding: 0 8px;
  border: 1px solid var(--la-line); border-radius: var(--la-radius); background: var(--la-input); color: var(--la-muted);
  input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--la-text); font-size: 12px; }
  button { padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; }
}
.session-row {
  position: relative; display: flex; align-items: center; border-radius: var(--la-radius);
  &.active { background: var(--la-hover); box-shadow: inset 2px 0 0 var(--la-accent); }
  &:hover { background: var(--la-hover); }
  &__actions { display: flex; opacity: .2; border-radius: var(--la-radius); background: var(--la-sidebar); }
  &:hover &__actions, &:focus-within &__actions { opacity: 1; }
  &__actions .icon-button { width: 24px; height: 26px; }
  .sidebar__conversation { min-width: 0; }
}
.is-collapsed { width: 64px; flex-basis: 64px; padding-inline: 8px; }
.is-collapsed .sidebar__brand { justify-content: center; margin-bottom: 18px; }
.is-collapsed .sidebar__new, .is-collapsed .sidebar__navigation button, .is-collapsed .sidebar__settings { justify-content: center; padding-inline: 0; }
.is-collapsed .sidebar__new span, .is-collapsed kbd, .is-collapsed .sidebar__navigation span, .is-collapsed .sidebar__settings span, .is-collapsed .sidebar__settings > svg:last-child { display: none; }
@media (max-width: 760px) {
  .sidebar { position: fixed; inset: 0 auto 0 0; width: 270px; }
  .sidebar.is-collapsed { transform: translateX(-100%); width: 270px; pointer-events: none; visibility: hidden; }
  .sidebar-backdrop { display: block; position: fixed; inset: 0; z-index: 29; border: 0; background: #0009; backdrop-filter: blur(3px); }
}
</style>
