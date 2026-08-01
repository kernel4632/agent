<!--
工具展示条：用易读标题、预览、回退和三选一审批表达一次 Agent 操作。
展开只控制本条详情，审批与回退继续交给对话 Command。
调用示例：<ToolCall :tool="tool" @approval="decide" />。
-->
<script setup>
import { computed, ref } from 'vue'                                  // 引入状态文案和展开状态
import { t } from '../i18n.js'                                       // 引入响应式界面翻译

const props = defineProps({ tool: { type: Object, required: true } }) // 当前工具的输入、预览和状态
const emit = defineEmits(['rollback', 'approval'])                    // 向对话页反馈用户动作
const open = ref(props.tool.status === 'waiting')                     // 待审批工具默认展开
const labels = { waiting: 'waiting', running: 'running', completed: 'completed', rejected: 'rejected' } // 状态映射到翻译键
const status = computed(() => t(labels[props.tool.status] || 'completed')) // 未知终态使用稳定完成反馈
const icons = { read_file: 'description', write_file: 'edit_document', run_command: 'terminal', web_fetch: 'language', delegate_task: 'hub' } // 每类工具使用可快速辨认的语义图标


// --- 提交审批决定 ---
function decide(decision) {
  emit('approval', { toolCallID: props.tool.id, decision })           // 只传业务身份和决定
}
</script>

<template>
  <m3e-card class="tool-strip" :class="[`is-${tool.status}`, { 'is-open': open }]">
    <div class="tool-strip__line">
      <div class="tool-strip__summary" role="button" tabindex="0" :aria-expanded="open" @click="open = !open" @keydown.enter="open = !open" @keydown.space.prevent="open = !open">
        <span class="tool-strip__icon"><m3e-icon :name="icons[tool.name] || 'build'"></m3e-icon></span>
        <strong>{{ tool.title || tool.name }}</strong>
        <span class="tool-strip__preview">{{ tool.preview }}</span>
        <span class="tool-strip__status"><i></i>{{ status }}</span>
      </div>
      <m3e-icon-button v-if="tool.checkpoint" :aria-label="t('rollbackHere')" :title="t('rollbackHere')" @click="emit('rollback', tool.checkpoint)"><m3e-icon name="undo"></m3e-icon></m3e-icon-button>
      <m3e-icon-button :aria-label="t(open ? 'collapseTool' : 'expandTool')" :title="t(open ? 'collapseTool' : 'expandTool')" @click="open = !open"><m3e-icon name="keyboard_arrow_down"></m3e-icon></m3e-icon-button>
    </div>

    <div v-if="open" class="tool-strip__detail">
      <div><span>{{ t('input') }}</span><pre>{{ JSON.stringify(tool.input || {}, null, 2) }}</pre></div>
      <p>{{ tool.preview }}</p>
    </div>

    <footer v-if="tool.status === 'waiting'" class="tool-strip__approval">
      <m3e-button class="approval-deny" @click="decide('deny')">{{ t('deny') }}</m3e-button>
      <m3e-button variant="tonal" @click="decide('allow-once')">{{ t('allow') }}</m3e-button>
      <m3e-button variant="filled" @click="decide('always-allow')">{{ t('alwaysAllow') }}</m3e-button>
    </footer>
  </m3e-card>
</template>

<style lang="scss" src="../styles/components/ToolCall.scss"></style>
