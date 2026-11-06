<!--
会话顶部栏：左边菜单（只在手机）和标题，右边任务清单和设置。
任务清单只在模型真的产生过清单后出现；上下文与用量移到输入框下方。
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
import Icon from '../../ui/Icon.vue'
import Button from '../../ui/Button.vue'
import Dialog from '../../ui/Dialog.vue'
import Field from '../../ui/Field.vue'
import { latestTodos } from "../../utils/tool.js"
import { Session } from "../../features/session.js"
import { NEW_SESSION_TITLE } from '../../defaults.js'

const props = defineProps({
  session: { type: Object, default: null },              // 当前打开的完整会话
  todoOpen: Boolean,                                     // 右侧任务清单是否打开
})
const emit = defineEmits(['menu', 'settings', 'update:todoOpen'])

const title = computed(() => props.session ? props.session.title || '新会话' : NEW_SESSION_TITLE)
const hasTodos = computed(() => {
  if (!props.session) return false
  const fromMessages = latestTodos(props.session.messages || [])
  return (fromMessages.length ? fromMessages : props.session.todos || []).length > 0
})
watch(hasTodos, value => { if (!value && props.todoOpen) emit('update:todoOpen', false) })

const renameOpen = ref(false)
const titleDraft = ref('')

function openRename(event) {
  event?.currentTarget?.focus({ preventScroll: true })
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
    <Button icon class="topbar__menu" label="打开会话抽屉" title="打开会话抽屉" @click="emit('menu')"><Icon name="menu" :size="18" /></Button>

    <div class="topbar__heading">
      <h1 :title="title"><button v-if="session" type="button" class="topbar__title" @click="openRename">{{ title }}</button><template v-else>{{ title }}</template></h1>
    </div>

    <div class="topbar__actions">
      <Button icon v-if="session && hasTodos" class="topbar__todo session-todo-toggle" label="任务清单" title="任务清单" :active="todoOpen" @click="emit('update:todoOpen', !todoOpen)"><Icon :name="todoOpen ? 'close' : 'todo'" :size="18" /></Button>
      <Button icon label="设置" title="设置" @click="emit('settings')"><Icon name="settings" :size="18" /></Button>
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

<style scoped lang="scss" src="../../styles/components/navigation/TopBar.scss"></style>
