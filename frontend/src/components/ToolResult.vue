<!--
  工具结果分发：工具脚本的 ui.view 决定使用哪个独立视图。
  results/*View.vue 自动登记输出形式；动作与结果属于同一可见区域。
  调用示例：<ToolResult :tool="tool" />
-->
<script setup>
import { Notice } from '../commands/notice.js'
import { copyText } from '../utils/clipboard.js'
import { Icon, Button } from '../ui/index.js'
import { computed } from 'vue'
import { uiFor, actionTarget, toolActions } from '../commands/tool.js'


const props = defineProps({ tool: { type: Object, required: true } })

const modules = import.meta.glob('./results/*View.vue', { eager: true })
const views = Object.fromEntries(Object.entries(modules).flatMap(([file, module]) => {
  const name = file.split('/').at(-1).replace('View.vue', '').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
  return (module.kinds || [name]).map(kind => [kind, module.default])
}))

const view = computed(() => views[uiFor(props.tool.name).view] || views.generic)
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
  <div class="tool-view">
    <component :is="view" :tool="tool" />
    <div v-if="actions.length" class="tool-actions">
      <Button v-for="action in actions" :key="action.id" variant="ghost" size="small" @click="run(action)">
        <Icon v-if="action.icon" :name="action.icon" :size="13" />{{ action.label }}
      </Button>
    </div>
  </div>
</template>

<style lang="scss" src="../styles/components/ToolResult.scss"></style>
