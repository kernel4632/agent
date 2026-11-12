<!--
会话顶部栏：左边菜单（只在手机）和标题，右边搜索、任务清单和设置。
搜索只在已有会话时出现；点击后由 App 打开常驻的聊天记录搜索弹窗。
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
const emit = defineEmits(['menu', 'settings', 'search', 'update:todoOpen'])

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
      <Button v-if="session" icon class="topbar__search" label="搜索聊天记录" title="搜索聊天记录" @click="emit('search')"><Icon name="search" :size="18" /></Button>
      <Button v-for="item in extensionTopbarItems" :key="item.id" icon :label="item.label" :title="item.label" :active="item.active?.value" @click="item.onClick"><Icon :name="item.icon" :size="18" /></Button>
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
