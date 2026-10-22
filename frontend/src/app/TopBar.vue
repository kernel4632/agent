<!--
会话顶部栏：左边菜单（只在手机）、中间标题和模型副标题，右边文件面板和新建对话。
只读取传入的会话和工作区；切换模型调用现有命令。
调用示例：
<TopBar
  :session="session"
  :workspace="selectedWorkspace"
  :review-open="reviewOpen"
  @menu="drawerOpen = true"
  @new="openDraft"
  @update:review-open="reviewOpen = $event"
/>
-->
<script setup>
import { computed, ref } from 'vue'
import { AppIcon, Button, Dialog, Field, IconButton, Select } from '../ui/index.js'
import { store } from '../store.js'
import { Session } from '../commands/session.js'

const props = defineProps({
  session: { type: Object, default: null },              // 当前打开的完整会话
  workspace: { type: Object, default: null },            // 当前工作区，用在空对话副标题
  reviewOpen: Boolean,                                   // 右侧文件面板是否打开
})
const emit = defineEmits(['menu', 'new', 'update:reviewOpen'])

const title = computed(() => props.session ? props.session.title || '新会话' : '新对话')
const draftSubtitle = computed(() => `la / ${store.config.activeModel || '未选择模型'}`)

// 会话模型下拉：列出所有供应商下的模型，当前模型不在配置里时也保留一条。
const allModels = computed(() => Object.entries(store.config.providers || {})
  .flatMap(([provider, entry]) => (entry.models || []).map(model => ({ provider, model }))))

const modelOptions = computed(() => {
  const list = [...allModels.value]
  const current = props.session ? `${props.session.provider}/${props.session.model}` : ''
  if (current && !list.some(item => `${item.provider}/${item.model}` === current)) {
    list.unshift({ provider: props.session.provider, model: props.session.model })
  }
  return list.map(item => ({
    value: `${item.provider}/${item.model}`,
    label: `${item.model} (${item.provider})`,
  }))
})

const modelSelection = computed(() => props.session ? `${props.session.provider}/${props.session.model}` : '')

async function switchModel(value) {
  if (!value || !props.session) return
  const index = value.indexOf('/')
  if (index < 0) return
  const provider = value.slice(0, index)
  const model = value.slice(index + 1)
  if (provider === props.session.provider && model === props.session.model) return
  await Session.selectModel(props.session.id, provider, model)
}

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
      <Select
        v-if="session"
        class="topbar__model session-model-field"
        select-class="session-model"
        label="当前会话模型"
        :model-value="modelSelection"
        :options="modelOptions"
        :disabled="session.status === 'running'"
        :title="session.status === 'running' ? '任务运行中，停止后才能切换模型' : '切换模型'"
        @update:model-value="switchModel"
      />
      <span v-else class="topbar__subtitle">{{ draftSubtitle }}</span>
    </div>

    <div class="topbar__actions">
      <IconButton v-if="session" class="topbar__review session-review-toggle" label="文件面板" title="文件面板" :active="reviewOpen" @click="emit('update:reviewOpen', !reviewOpen)"><AppIcon :name="reviewOpen ? 'close' : 'list'" :size="18" /></IconButton>
      <IconButton label="新建对话" title="新建对话" @click="emit('new')"><AppIcon name="new-chat" :size="18" /></IconButton>
    </div>
  </header>

  <Dialog :open="renameOpen" label="重命名会话" @update:open="renameOpen = $event">
    <form @submit.prevent="saveTitle">
      <h2>编辑标题</h2>
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
  gap: 8px;
  padding: 0 12px;
  background: transparent;
}
.topbar__menu { display: inline-flex; }
.topbar__heading { display: flex; min-width: 0; flex: 1; flex-direction: column; justify-content: center; gap: 2px; }
.topbar__heading h1 {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--la-text);
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
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
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 24px; }
.topbar__subtitle { min-width: 0; overflow: hidden; color: color-mix(in srgb, var(--la-text) 65%, transparent); font-size: 8px; font-weight: 400; line-height: 12px; text-overflow: ellipsis; white-space: nowrap; }
.topbar__model { display: block; max-width: min(320px, 42vw); min-width: 0; }
.topbar__model :deep(.ui-select__input) {
  width: 100%;
  height: 12px;
  padding: 0;
  overflow: hidden;
  border: 0;
  background: transparent;
  color: color-mix(in srgb, var(--la-text) 65%, transparent);
  font-size: 8px;
  line-height: 12px;
  text-overflow: ellipsis;
  appearance: none;
  cursor: pointer;
}
.topbar__model :deep(.ui-select__input:focus) { box-shadow: none; }
.topbar__model :deep(.ui-select__input option) { background: var(--la-panel); color: var(--la-text); }
.topbar__actions { display: flex; flex: none; align-items: center; gap: 2px; }

/* 文件面板在面板本身隐藏的尺寸下也一起隐藏，避免点了没有反应。 */
@media (max-width: 1023px) {
  .topbar__review { display: none; }
}
@media (max-width: 767px) {
  .topbar { padding: 0 8px; gap: 2px; }
  .topbar__copy { display: none; }
  .topbar__heading h1 { font-size: 17px; line-height: 23px; }
  .topbar__model { max-width: 38vw; }
}
@media (min-width: 1100px) and (orientation: landscape) {
  .topbar__menu { display: none; }
}
</style>
