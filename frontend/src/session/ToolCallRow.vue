<!--
  单次工具调用行：标题、状态、输入/结果渲染和等待审批。
  展开状态留在本组件内，AssistantMessage 只负责按顺序排列多条工具调用。
-->
<script setup>
import { ref } from 'vue'
import { AppIcon, Button, IconButton } from '../ui/index.js'
import { Chat } from '../commands/chat.js'
import { UI } from '../commands/ui.js'
import ToolView from './tools/ToolView.vue'
import { toolIcon, toolLabel } from './tool-ui.js'

const props = defineProps({
  tool: { type: Object, required: true },
  message: { type: Object, required: true },
  sessionId: { type: String, required: true },
  running: Boolean,
  canRollback: Boolean,
  showActions: Boolean,
})
const emit = defineEmits(['rollback'])

const open = ref(props.tool.status === 'waiting' || props.tool.status === 'running')
const statusLabel = status => ({ waiting: '等待你的许可', running: '正在执行', completed: '已完成', error: '执行失败', rejected: '已拒绝' }[status] || '等待结果')
const statusClass = status => `is-${status || 'waiting'}`

function decide(decision) {
  Chat.decide(props.sessionId, props.tool.id, decision)
}
</script>

<template>
  <div class="list-row list-row--tool" :class="{ 'is-live': tool.status === 'running' }">
    <span class="list-row__icon"><AppIcon :name="toolIcon(tool)" :size="14" /></span>
    <div class="list-row__main">
      <button type="button" class="list-row__toggle tool-toggle" :aria-expanded="open" @click="open = !open">
        <span class="list-row__label" :class="{ 'is-live': tool.status === 'running' }" :title="tool.name">{{ toolLabel(tool) }}</span>
        <span class="list-row__status" :class="statusClass(tool.status)">{{ statusLabel(tool.status) }}</span>
        <AppIcon name="down" :size="14" class="row-caret" :class="{ 'is-open': open }" aria-hidden="true" />
      </button>
      <div class="flow-content" :class="{ 'is-open': open }">
        <div class="flow-content__inner">
          <div class="flow-content__body tool-body">
            <ToolView :tool="tool" />
            <div v-if="tool.status === 'waiting'" class="approval" @click.stop>
              <p>此操作需要你的许可。请检查上方工具及参数。</p>
              <div>
                <Button variant="danger" :disabled="tool.deciding" @click="decide('deny')">拒绝</Button>
                <Button :disabled="tool.deciding" @click="decide('always-allow')">始终允许此参数</Button>
                <Button variant="primary" :disabled="tool.deciding" @click="decide('allow-once')">允许一次</Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-if="showActions" class="list-row__actions message__actions">
      <IconButton size="small" label="复制消息" title="复制消息" @click="UI.copy(message.content)"><AppIcon name="copy" :size="14" /></IconButton>
      <IconButton v-if="canRollback" size="small" label="回退到这条回复" title="删除这条消息及之后的内容" :disabled="running" @click="emit('rollback')"><AppIcon name="undo" :size="14" /></IconButton>
    </div>
  </div>
</template>
