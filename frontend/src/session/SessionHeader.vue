<!--
会话顶部：项目图标、会话标题、模型下拉框、文件面板开关、复制会话 ID 和创建分支。
模型切换只把选中的值上抛，具体请求仍由 App 处理；复制和分支直接调用现有命令。
调用示例：
<SessionHeader v-model:review-open="reviewOpen" :session="session" :workspace="selectedWorkspace" :models="modelOptions" @switch-model="switchModel" />
-->
<script setup>
import AppIcon from '../components/AppIcon.vue'
import IconButton from '../ui/IconButton.vue'
import { Session } from '../commands/session.js'
import { UI } from '../commands/ui.js'

defineProps({
  session: { type: Object, required: true },            // 当前打开的会话
  workspace: Object,                                    // 会话所属工作区，用来显示项目路径
  models: { type: Array, default: () => [] },           // 形如 [{ provider, model }] 的下拉选项
  reviewOpen: Boolean,                                  // 右侧文件面板是否打开
})

const emit = defineEmits(['update:reviewOpen', 'switch-model'])
</script>

<template>
  <header class="session-header">
    <IconButton class="session-header__project" label="项目" :title="workspace?.path || ''"><AppIcon name="folder" :size="16" /></IconButton>
    <h1>{{ session.title || '新会话' }}</h1>
    <select v-if="session" class="session-model" aria-label="当前会话模型" :value="`${session.provider}/${session.model}`" :disabled="session.status === 'running'" :title="session.status === 'running' ? '任务运行中，停止后才能切换模型' : '切换模型'" @change="emit('switch-model', $event.target.value)">
      <option v-for="item in models" :key="`${item.provider}/${item.model}`" :value="`${item.provider}/${item.model}`">{{ item.provider }} / {{ item.model }}</option>
    </select>
    <div class="session-header__actions">
      <IconButton class="session-review-toggle" label="文件面板" title="文件面板" :active="reviewOpen" @click="emit('update:reviewOpen', !reviewOpen)"><AppIcon name="panel" :size="15" /></IconButton>
      <IconButton label="复制会话 ID" title="复制会话 ID" @click="UI.copy(session.id)"><AppIcon name="link" :size="15" /></IconButton>
      <IconButton label="创建分支" title="创建分支" :disabled="session.status === 'running'" @click="Session.fork(session.id)"><AppIcon name="branch" :size="15" /></IconButton>
    </div>
  </header>
</template>

<style scoped lang="scss">
.session-header { display: flex; flex: 0 0 48px; align-items: center; gap: 6px; min-width: 0; padding: 0 8px 0 10px; border-bottom: .5px solid var(--la-line); }
.session-header__project { color: var(--la-muted); }
.session-header h1 { min-width: 0; margin: 0; overflow: hidden; color: var(--la-text); font-size: 13px; font-weight: 530; line-height: 16px; text-overflow: ellipsis; white-space: nowrap; }
.session-model { max-width: 220px; min-width: 0; margin-left: auto; overflow: hidden; border: 0; background: transparent; color: var(--la-muted); font-size: 12px; text-overflow: ellipsis; cursor: pointer; }
.session-model option { background: var(--la-panel); color: var(--la-text); }
.session-header__actions { display: flex; align-items: center; gap: 2px; margin-left: auto; }
.session-model + .session-header__actions { margin-left: 4px; }
.session-review-toggle.is-active { background: var(--la-layer-03); color: var(--la-text); }
@media (max-width: 1023px) {
  .session-review-toggle { display: none; }
}
@media (max-width: 767px) {
  .session-model { max-width: 110px; font-size: 11px; }
  .session-header { padding-inline: 6px; }
}
</style>
