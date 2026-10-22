<!--
  工具声明式操作：目前支持复制和打开网址。
  具体动作由工具脚本的 ui.actions 决定，渲染器不关心工具名。
-->
<script setup>
import { computed } from 'vue'
import { AppIcon, Button } from '../../ui/index.js'
import { UI } from '../../commands/ui.js'
import { actionTarget, toolActions } from '../tool-ui.js'

const props = defineProps({ tool: { type: Object, required: true } })
const actions = computed(() => toolActions(props.tool))

async function run(action) {
  const value = actionTarget(props.tool, action)
  if (!value) return
  if (action.type === 'copy') await UI.copy(value)
  if (action.type === 'open') window.open(value, '_blank', 'noopener,noreferrer')
}
</script>

<template>
  <div v-if="actions.length" class="tool-actions">
    <Button v-for="action in actions" :key="action.id" variant="ghost" size="small" @click="run(action)">
      <AppIcon v-if="action.icon" :name="action.icon" :size="13" />{{ action.label }}
    </Button>
  </div>
</template>
