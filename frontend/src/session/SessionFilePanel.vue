<!--
会话右侧文件面板：列出本次会话改动过的文件和工作区文件，点文件名复制路径。
文件列表由 session.messages 里的工具参数和 workspace.files 计算，父组件只控制开关。
外壳使用 KimaDrawer（right），内容仍是领域列表。
调用示例：
<SessionFilePanel v-model:open="reviewOpen" :session="session" :workspace="selectedWorkspace" />
-->
<script setup>
import { computed } from 'vue'
import { KimaDrawer } from '@kernel4632/kima'
import { AppIcon, Button } from '../ui/index.js'
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
  <KimaDrawer
    class="session-review"
    :open="open"
    title="文件"
    placement="right"
    @update:open="emit('update:open', $event)"
  >
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
  </KimaDrawer>
</template>

<style scoped lang="scss">
.session-review { --kima-drawer-max-width: 380px; }
.session-review__body { display: flex; flex-direction: column; gap: 24px; }
.session-review__section { display: flex; flex-direction: column; gap: 2px; }
.session-review__section h3 { margin: 0 0 6px; color: var(--la-muted); font-size: 13px; font-weight: 600; line-height: 18px; }
.session-review__section p { margin: 4px; color: var(--la-muted); font-size: 13px; line-height: 20px; }
.session-review__file { display: block; width: 100%; min-height: 40px; padding: 8px 12px; overflow: hidden; border: 0; border-radius: 10px; background: transparent; color: var(--la-secondary); text-align: left; font: 13px/20px var(--la-font-mono); text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.session-review__file:hover { background: var(--la-hover); color: var(--la-text); }
</style>
