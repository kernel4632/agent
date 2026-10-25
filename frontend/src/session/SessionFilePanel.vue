<!--
会话右侧文件面板：列出本次会话改动过的文件和工作区文件，点文件名复制路径。
文件列表由 session.messages 里的工具参数和 workspace.files 计算，父组件只控制开关。
调用示例：
<SessionFilePanel v-model:open="reviewOpen" :session="session" :workspace="selectedWorkspace" />
-->
<script setup>
import { computed } from 'vue'
import { AppIcon, Button, IconButton } from '../ui/index.js'
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
  <template v-if="open">
    <div class="session-review__scrim" aria-hidden="true" @click="emit('update:open', false)"></div>
    <aside class="session-review" aria-label="文件面板">
      <header class="session-review__head">
        <h2>文件</h2>
        <IconButton label="关闭文件面板" @click="emit('update:open', false)"><AppIcon name="close" :size="14" /></IconButton>
      </header>
      <div class="session-review__body">
        <section class="session-review__section">
          <h3>本次改动</h3>
          <Button v-for="file in changedFiles" :key="file" variant="plain" class="session-review__file" :title="file" @click="UI.copy(file)">{{ file }}</Button>
          <p v-if="!changedFiles.length">本次会话没有文件改动</p>
        </section>
        <section class="session-review__section">
          <h3>工作区文件</h3>
          <Button v-for="file in workspaceFiles" :key="file" variant="plain" class="session-review__file" :title="file" @click="UI.copy(file)">{{ file }}</Button>
          <p v-if="!workspaceFiles.length">没有可显示的文件</p>
        </section>
      </div>
    </aside>
  </template>
</template>

<style scoped lang="scss">
.session-review {
  position: fixed;
  inset: 0 0 0 auto;
  z-index: 43;
  display: flex;
  width: min(360px, 92vw);
  max-width: 100vw;
  flex-direction: column;
  border-left: .5px solid var(--la-line);
  border-radius: 20px 0 0 20px;
  background: var(--la-panel);
  box-shadow: -12px 0 36px rgba(0, 0, 0, .18);
  animation: review-in .2s cubic-bezier(.2, 0, 0, 1);
}
@keyframes review-in { from { transform: translateX(24px); opacity: .5; } to { transform: none; opacity: 1; } }
.session-review__scrim { position: fixed; inset: 0; z-index: 42; background: color-mix(in srgb, #000 32%, transparent); }
.session-review__head { display: flex; height: 64px; flex: none; align-items: center; justify-content: space-between; padding: 0 12px 0 20px; border-bottom: .5px solid var(--la-line); color: var(--la-text); }
.session-review__head h2 { margin: 0; font-size: 16px; font-weight: 600; line-height: 24px; }
.session-review__body { display: flex; min-height: 0; flex: 1; flex-direction: column; gap: 24px; overflow-y: auto; padding: 16px 12px 24px; }
.session-review__section { display: flex; flex-direction: column; gap: 2px; }
.session-review__section h3 { margin: 8px 8px 4px; color: var(--la-muted); font-size: 13px; font-weight: 600; line-height: 18px; }
.session-review__section p { margin: 4px 8px; color: var(--la-muted); font-size: 13px; line-height: 20px; }
.session-review__file { display: block; width: 100%; min-height: 40px; padding: 8px 12px; overflow: hidden; border: 0; border-radius: 10px; background: transparent; color: var(--la-secondary); text-align: left; font: 13px/20px var(--la-font-mono); text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.session-review__file:hover { background: var(--la-hover); color: var(--la-text); }
</style>
