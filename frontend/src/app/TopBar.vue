<!--
会话顶部栏：左边菜单（只在手机）和标题，右边任务清单、上下文统计和设置。
任务清单只在模型真的产生过清单后出现；上下文统计默认是一个圆环，点开看数据。
只读取传入的会话；切换模型调用现有命令。
调用示例：
<TopBar
  :session="session"
  :todo-open="todoOpen"
  @menu="drawerOpen = true"
  @settings="openSettings()"
  @update:todo-open="todoOpen = $event"
/>
-->
<script setup>
import { computed, ref, watch } from 'vue'
import { AppIcon, Button, Dialog, Field, IconButton } from '../ui/index.js'
import SessionStats from '../session/SessionStats.vue'
import { sessionStats } from '../session/stats.js'
import { latestTodos } from '../session/todos.js'
import { Session } from '../session/session.js'
import { NEW_SESSION_TITLE } from '../defaults.js'

const props = defineProps({
  session: { type: Object, default: null },              // 当前打开的完整会话
  todoOpen: Boolean,                                     // 右侧任务清单是否打开
})
const emit = defineEmits(['menu', 'settings', 'update:todoOpen'])

const title = computed(() => props.session ? props.session.title || '新会话' : NEW_SESSION_TITLE)
const stats = computed(() => sessionStats(props.session))
const hasTodos = computed(() => {
  if (!props.session) return false
  const fromMessages = latestTodos(props.session.messages || [])
  return (fromMessages.length ? fromMessages : props.session.todos || []).length > 0
})
watch(hasTodos, value => { if (!value && props.todoOpen) emit('update:todoOpen', false) })

const renameOpen = ref(false)
const titleDraft = ref('')

function openRename() {
  if (!props.session) return
  titleDraft.value = props.session.title || ''
  renameOpen.value = true
}

async function saveTitle() {
  if (!props.session || !titleDraft.value.trim()) return
  if (await Session.rename(props.session.id, titleDraft.value)) renameOpen.value = false
}
</script>

<template>
  <header class="topbar">
    <IconButton class="topbar__menu" label="打开会话抽屉" title="打开会话抽屉" @click="emit('menu')"><AppIcon name="menu" :size="18" /></IconButton>

    <div class="topbar__heading">
      <h1 :title="title"><button v-if="session" type="button" class="topbar__title" @click="openRename">{{ title }}</button><template v-else>{{ title }}</template></h1>
    </div>

    <div class="topbar__actions">
      <IconButton v-if="session && hasTodos" class="topbar__todo session-todo-toggle" label="任务清单" title="任务清单" :active="todoOpen" @click="emit('update:todoOpen', !todoOpen)"><AppIcon :name="todoOpen ? 'close' : 'todo'" :size="18" /></IconButton>
      <SessionStats v-if="stats" :stats="stats" />
      <IconButton label="设置" title="设置" @click="emit('settings')"><AppIcon name="settings" :size="18" /></IconButton>
    </div>
  </header>

  <Dialog :open="renameOpen" label="重命名会话" @update:open="renameOpen = $event">
    <form @submit.prevent="saveTitle">
      <Field v-model="titleDraft" label="标题" placeholder="输入标题" required maxlength="120" />
      <div class="dialog-actions">
        <Button type="button" @click="renameOpen = false">取消</Button>
        <Button type="submit" :disabled="!titleDraft.trim()">保存</Button>
      </div>
    </form>
  </Dialog>
</template>

<style scoped lang="scss">
.topbar {
  display: flex;
  height: var(--la-topbar-height);
  flex: 0 0 var(--la-topbar-height);
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  background: transparent;
}
.topbar__menu { display: inline-flex; }
.topbar__heading { display: flex; min-width: 0; flex: 1; flex-direction: column; justify-content: center; gap: 2px; }
.topbar__heading h1 {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--la-text);
  font-size: 18px;
  font-weight: 600;
  line-height: 26px;
  letter-spacing: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.topbar__title {
  display: block;
  max-width: 100%;
  overflow: hidden;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: text;
}
.topbar__title:hover { color: var(--la-accent); }
.topbar__actions { display: flex; flex: none; align-items: center; gap: 4px; }

/* 手机上保留任务清单入口；标题让出空间，长标题自己截断。 */
@media (max-width: 767px) {
  .topbar { padding: 0 8px; gap: 4px; }
  .topbar__heading h1 { font-size: 16px; line-height: 24px; }
}
</style>
