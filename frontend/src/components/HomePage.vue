<script setup>
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { Session } from '../commands/session.js'
import { UI } from '../commands/ui.js'

const props = defineProps({
  workspaces: { type: Array, default: () => [] },
  activeWorkspaceId: String,
  activeSessionId: String,
})
const emit = defineEmits(['open', 'new', 'select-workspace', 'settings'])

const search = ref('')
const workspace = computed(() => props.workspaces.find(item => item.id === props.activeWorkspaceId) || props.workspaces[0])
const sessions = computed(() => workspace.value?.sessions || [])
const visible = computed(() => {
  const query = search.value.trim().toLowerCase()
  return sessions.value.filter(item => !query || (item.title || '').toLowerCase().includes(query))
})

const palette = ['#3250df', '#2eaf5a', '#ee7330', '#e4429e', '#623be2', '#0096b8']
const hash = value => {
  let number = 0
  for (const char of String(value)) number = (number * 31 + char.charCodeAt(0)) >>> 0
  return number
}
const projectColor = value => palette[hash(value) % palette.length]
const initial = value => (value || '?').trim().slice(0, 1).toUpperCase()

const dialog = ref(null)
const dialogMode = ref('rename')
const target = ref(null)
const value = ref('')
const busy = ref(false)

function chooseWorkspace(id) {
  emit('select-workspace', id)
}

function closeMenus() {
  document.querySelectorAll('.home-session__menu[open]').forEach(item => item.removeAttribute('open'))
}

function openRename(session) {
  closeMenus()
  dialogMode.value = 'rename'
  target.value = session
  value.value = session.title || ''
  dialog.value.showModal()
}

function openDelete(session) {
  closeMenus()
  dialogMode.value = 'delete'
  target.value = session
  value.value = ''
  dialog.value.showModal()
}

async function submitDialog() {
  if (busy.value) return
  busy.value = true
  try {
    const ok = dialogMode.value === 'rename'
      ? await Session.rename(target.value.id, value.value)
      : await Session.remove(target.value.id)
    if (ok) dialog.value.close()
  } finally { busy.value = false }
}
</script>

<template>
  <section class="home-panel" aria-label="项目与会话">
    <div class="home-grid">
      <div class="home-mobile-project">
        <span class="project-avatar" :style="{ background: projectColor(workspace?.id) }">{{ initial(workspace?.name) }}</span>
        <select :value="workspace?.id" aria-label="选择项目" @change="chooseWorkspace($event.target.value)">
          <option v-for="item in workspaces" :key="item.id" :value="item.id">{{ item.name || item.path }}</option>
        </select>
      </div>

      <aside class="home-projects" aria-label="项目">
        <header class="home-projects__head">
          <span>项目</span>
          <button class="icon-button" aria-label="管理工作区" title="管理工作区" @click="emit('settings')"><AppIcon name="plus" :size="15" /></button>
        </header>
        <div class="home-projects__list">
          <button v-for="item in workspaces" :key="item.id" class="project-row" :class="{ 'is-active': item.id === workspace?.id }" @click="chooseWorkspace(item.id)">
            <span class="project-avatar" :style="{ background: projectColor(item.id) }">{{ initial(item.name) }}</span>
            <span class="project-row__name">{{ item.name || item.path }}</span>
          </button>
          <p v-if="!workspaces.length" class="home-projects__empty">还没有工作区</p>
        </div>
        <div class="home-projects__bottom">
          <button class="project-row" @click="emit('settings')"><AppIcon name="settings" :size="15" /><span class="project-row__name">设置</span></button>
          <button class="project-row" @click="UI.notify('帮助文档暂未接入')"><AppIcon name="info" :size="15" /><span class="project-row__name">帮助</span></button>
        </div>
      </aside>

      <div class="home-sessions">
        <div class="home-sessions__top">
          <label class="home-search">
            <AppIcon name="search" :size="15" />
            <input v-model="search" type="search" aria-label="搜索会话" placeholder="搜索会话" />
          </label>
          <button v-if="sessions.length" class="home-new" @click="emit('new')"><AppIcon name="edit" :size="14" />新建会话</button>
        </div>

        <div class="home-sessions__list">
          <template v-if="visible.length">
            <div class="group-label">最近会话</div>
            <div v-for="item in visible" :key="item.id" class="home-session" :class="{ 'is-active': item.id === activeSessionId }">
              <button class="home-session__main" @click="emit('open', item.id)">
                <span class="home-session__avatar" :style="{ background: projectColor(workspace?.id) }">{{ initial(item.title) }}</span>
                <span class="home-session__title">{{ item.title || '新会话' }}</span>
                <span class="home-session__project">{{ workspace?.name }}</span>
              </button>
              <details class="home-session__menu">
                <summary :aria-label="`${item.title || '新会话'} 的更多操作`"><AppIcon name="more" :size="15" /></summary>
                <div class="home-session__menu-pop">
                  <button @click.prevent="openRename(item)">重命名</button>
                  <button @click.prevent="openDelete(item)">删除</button>
                </div>
              </details>
            </div>
          </template>
          <div v-else class="home-empty">
            <strong>{{ search ? '没有找到匹配的会话' : '还没有会话' }}</strong>
            <p>{{ search ? '换个关键词试试。' : '新建一个会话，开始和 la 一起工作。' }}</p>
            <button v-if="!search" class="button" @click="emit('new')"><AppIcon name="edit" :size="14" />新建会话</button>
            <button v-else class="text-button" @click="search = ''">清除搜索</button>
          </div>
        </div>
      </div>
    </div>

    <dialog ref="dialog" class="dialog" :aria-label="dialogMode === 'rename' ? '重命名会话' : '删除会话'" @cancel="busy && $event.preventDefault()">
      <form @submit.prevent="submitDialog">
        <h2>{{ dialogMode === 'rename' ? '重命名会话' : '删除这段对话？' }}</h2>
        <p>{{ dialogMode === 'rename' ? '给这段对话起一个容易记住的名字。' : '会话和历史记录将从服务器永久删除，无法恢复。' }}</p>
        <label v-if="dialogMode === 'rename'">会话名称<input v-model="value" class="field" required maxlength="120" /></label>
        <div class="dialog-actions">
          <button type="button" class="button" :disabled="busy" @click="dialog.close()">取消</button>
          <button class="button" :class="{ 'button--danger': dialogMode === 'delete' }" :disabled="busy">{{ dialogMode === 'rename' ? '保存名称' : '确认删除' }}</button>
        </div>
      </form>
    </dialog>
  </section>
</template>

<style scoped lang="scss">
.home-panel { display: flex; flex-direction: column; min-height: 0; }
.home-grid {
  display: grid;
  width: 100%;
  max-width: 1080px;
  height: 100%;
  min-height: 0;
  grid-template-columns: 280px minmax(0, 720px);
  gap: 32px;
  margin: 0 auto;
  padding: 24px 24px 48px;
}
.home-projects { display: flex; min-height: 0; flex-direction: column; }
.home-projects__head {
  display: flex;
  height: 28px;
  flex: none;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px 0 6px;
  color: var(--la-muted);
  font-size: 13px;
  font-weight: 530;
}
.home-projects__list { display: flex; min-height: 0; flex-direction: column; gap: 4px; overflow-y: auto; }
.home-projects__empty { margin: 8px 6px; color: var(--la-muted); font-size: 13px; }
.project-row {
  display: flex;
  width: 100%;
  height: 28px;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--la-secondary);
  text-align: left;
  font-size: 13px;
  font-weight: 440;
  cursor: pointer;
}
.project-row:hover { background: var(--la-layer-01); color: var(--la-text); }
.project-row.is-active { background: var(--la-layer-03); color: var(--la-text); }
.project-row__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.project-avatar {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  border-radius: 3px;
  color: #fff;
  font: 600 8px/1 var(--la-font-mono);
}
.home-projects__bottom { display: flex; flex-direction: column; gap: 2px; margin-top: auto; padding-top: 16px; }
.home-sessions { display: flex; min-height: 0; flex-direction: column; }
.home-sessions__top { display: flex; flex: none; align-items: center; gap: 8px; margin-bottom: 8px; }
.home-search {
  display: flex;
  height: 36px;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--la-layer-02) 60%, transparent);
  color: var(--la-muted);
}
.home-search:focus-within { background: var(--la-layer-02); }
.home-search input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--la-text); font-size: 13px; }
.home-search input::placeholder { color: var(--la-muted); }
.home-new {
  display: flex;
  height: 28px;
  flex: none;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--la-secondary);
  font-size: 13px;
  font-weight: 530;
  cursor: pointer;
}
.home-new:hover { background: var(--la-hover); color: var(--la-text); }
.home-sessions__list { display: flex; min-height: 0; flex: 1; flex-direction: column; gap: 1px; overflow-y: auto; padding-right: 4px; }
.group-label { display: flex; height: 28px; flex: none; align-items: center; padding: 0 6px; color: var(--la-muted); font-size: 13px; font-weight: 440; }
.home-session { display: flex; height: 40px; flex: none; align-items: center; border-radius: 6px; }
.home-session:hover, .home-session.is-active { background: var(--la-layer-01); }
.home-session__main {
  display: flex;
  height: 100%;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border: 0;
  background: transparent;
  color: var(--la-secondary);
  text-align: left;
  cursor: pointer;
}
.home-session__avatar {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  border-radius: 3px;
  color: #fff;
  font: 600 8px/1 var(--la-font-mono);
}
.home-session__title { min-width: 0; overflow: hidden; color: var(--la-text); font-size: 13px; font-weight: 530; text-overflow: ellipsis; white-space: nowrap; }
.home-session__project { margin-left: auto; color: var(--la-muted); font-size: 13px; font-weight: 440; white-space: nowrap; opacity: 0; transition: opacity .12s ease; }
.home-session:hover .home-session__project, .home-session.is-active .home-session__project { opacity: 1; }
.home-session__menu { position: relative; flex: none; margin-right: 4px; }
.home-session__menu summary {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  color: var(--la-muted);
  cursor: pointer;
  opacity: 0;
  list-style: none;
}
.home-session:hover .home-session__menu summary,
.home-session.is-active .home-session__menu summary,
.home-session__menu[open] summary { opacity: 1; }
.home-session__menu summary::-webkit-details-marker { display: none; }
.home-session__menu summary:hover { background: var(--la-hover); color: var(--la-text); }
.home-session__menu-pop {
  position: absolute;
  top: 26px;
  right: 0;
  z-index: 20;
  width: 140px;
  padding: 4px;
  border-radius: 6px;
  background: var(--la-layer-01);
  box-shadow: var(--la-shadow-floating);
}
.home-session__menu-pop button {
  display: block;
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--la-text);
  text-align: left;
  font-size: 13px;
  cursor: pointer;
}
.home-session__menu-pop button:hover { background: var(--la-hover); }
.home-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 52px 16px; text-align: center; }
.home-empty strong { color: var(--la-text); font-size: 13px; font-weight: 530; }
.home-empty p { max-width: 360px; margin: 0 0 8px; color: var(--la-muted); font-size: 13px; font-weight: 440; line-height: 20px; }
.home-mobile-project { display: none; }
@media (max-width: 767px) {
  .home-grid { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); align-content: start; gap: 8px; padding: 12px; }
  .home-projects { display: none; }
  .home-mobile-project {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 6px;
    border-radius: 6px;
    background: var(--la-layer-01);
  }
  .home-mobile-project select { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--la-text); font-size: 13px; }
  .home-sessions { padding-top: 4px; }
  .home-session__project { display: none; }
  .home-session { height: 48px; }
  .home-session__menu summary { opacity: 1; }
}
</style>
