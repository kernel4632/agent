<!--
  工具声明式操作：目前支持复制和打开网址。
  具体动作由工具脚本的 ui.actions 决定，渲染器不关心工具名。
  调用示例：<ToolActions :actions="tool.ui.actions" :input="tool.input" />
-->
<script setup>
import { Notice } from '../../commands/notice.js'
import { copyText } from '../../utils/clipboard.js'

import { computed } from 'vue'
import { AppIcon, Button } from '../../ui/index.js'
import { actionTarget, toolActions } from '../../commands/tool.js'

const props = defineProps({ tool: { type: Object, required: true } })
const actions = computed(() => toolActions(props.tool))

async function run(action) {
  const value = actionTarget(props.tool, action)
  if (!value) return
  if (action.type === 'copy') await copyMessage(value)
  if (action.type === 'open') window.open(value, '_blank', 'noopener,noreferrer')
}

// 复制只在本区域反馈，剪贴板工具不依赖页面。
async function copyMessage(text) { Notice.show(await copyText(text) ? '已复制' : '复制失败'); }
</script>

<template>
  <div v-if="actions.length" class="tool-actions">
    <Button v-for="action in actions" :key="action.id" variant="ghost" size="small" @click="run(action)">
      <AppIcon v-if="action.icon" :name="action.icon" :size="13" />{{ action.label }}
    </Button>
  </div>
</template>

<style scoped lang="scss" src="../../styles/session/tools/ToolActions.scss"></style>
