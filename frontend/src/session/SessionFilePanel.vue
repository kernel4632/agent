<!--
会话右侧文件面板：列出本次会话改动过的文件和工作区文件，点文件名复制路径。
文件列表由 session.messages 里的工具参数和 workspace.files 计算，父组件只控制开关。
调用示例：
<SessionFilePanel v-model:open="reviewOpen" :session="session" :workspace="selectedWorkspace" />
-->
<script setup>
import { computed } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import IconButton from '../ui/IconButton.vue'
import { UI } from '../commands/ui.js'

const props = defineProps({
  session: { type: Object, required: true },            // 当前会话，用来收集工具改动过的文件
  workspace: Object,                                    // 当前工作区，提供工作区文件列表
  open: Boolean,                                        // 面板是否展开
})

const emit = defineEmits(['update:open'])

// 工具调用的路径字段在不同工具里叫法不同，三种都认。
const changedFiles = computed(() => {
  const files = new Set()
  for (const message of props.session?.messages || []) {
    for (const tool of message.tools || []) {
      const path = tool.input?.path ?? tool.input?.filePath ?? tool.input?.file_path
      if (typeof path === 'string' && path) files.add(path)
    }
  }
  return [...files]
})

const workspaceFiles = computed(() => props.workspace?.files || [])
</script>

<template>
  <aside v-if="open" class="session-review" aria-label="文件面板">
    <header class="session-review__head">
      <span>文件</span>
      <IconButton label="关闭文件面板" @click="emit('update:open', false)"><AppIcon name="close" :size="14" /></IconButton>
    </header>
    <div class="session-review__body">
      <section class="session-review__section">
        <h2>本次改动</h2>
        <button v-for="file in changedFiles" :key="file" class="session-review__file" :title="file" @click="UI.copy(file)">{{ file }}</button>
        <p v-if="!changedFiles.length">本次会话没有文件改动</p>
      </section>
      <section class="session-review__section">
        <h2>工作区文件</h2>
        <button v-for="file in workspaceFiles" :key="file" class="session-review__file" :title="file" @click="UI.copy(file)">{{ file }}</button>
        <p v-if="!workspaceFiles.length">没有可显示的文件</p>
      </section>
    </div>
  </aside>
</template>

<style scoped lang="scss">
.session-review { display: flex; width: var(--la-review-width); flex: 0 0 var(--la-review-width); flex-direction: column; min-height: 0; border-left: .5px solid var(--la-line); background: var(--la-panel); }
.session-review__head { display: flex; height: 48px; flex: none; align-items: center; justify-content: space-between; padding: 0 8px 0 14px; border-bottom: .5px solid var(--la-line); color: var(--la-text); font-size: 13px; font-weight: 530; }
.session-review__body { display: flex; min-height: 0; flex: 1; flex-direction: column; gap: 20px; overflow-y: auto; padding: 8px 10px 20px; }
.session-review__section { display: flex; flex-direction: column; gap: 2px; }
.session-review__section h2 { margin: 8px 4px 4px; color: var(--la-muted); font-size: 12px; font-weight: 530; }
.session-review__section p { margin: 4px; color: var(--la-muted); font-size: 12px; line-height: 18px; }
.session-review__file { display: block; width: 100%; min-height: 24px; padding: 3px 6px; overflow: hidden; border: 0; border-radius: 4px; background: transparent; color: var(--la-secondary); text-align: left; font: 12px/18px var(--la-font-mono); text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.session-review__file:hover { background: var(--la-hover); color: var(--la-text); }
@media (max-width: 1023px) {
  .session-review { display: none; }
}
</style>
