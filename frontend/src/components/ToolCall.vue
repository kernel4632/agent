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


// --- 提交审批决定 ---
function decide(decision) {
  emit('approval', { toolCallID: props.tool.id, decision })           // 只传业务身份和决定
}
</script>

<template>
  <article class="tool-strip" :class="[`is-${tool.status}`, { 'is-open': open }]">
    <div class="tool-strip__line" @click="open = !open">
      <span class="tool-strip__icon">{{ tool.name === 'run_command' ? '>_' : '◇' }}</span>
      <strong>{{ tool.title || tool.name }}</strong>
      <span class="tool-strip__preview">{{ tool.preview }}</span>
      <span class="tool-strip__status"><i></i>{{ status }}</span>
      <button v-if="tool.checkpoint" type="button" :title="t('rollbackHere')" @click.stop="emit('rollback', tool.checkpoint)"><mdui-icon-undo></mdui-icon-undo></button>
      <button type="button" :aria-label="t(open ? 'collapseTool' : 'expandTool')" @click.stop="open = !open"><mdui-icon-expand-more></mdui-icon-expand-more></button>
    </div>

    <div v-if="open" class="tool-strip__detail">
      <div><span>{{ t('input') }}</span><pre>{{ JSON.stringify(tool.input || {}, null, 2) }}</pre></div>
      <p>{{ tool.preview }}</p>
    </div>

    <footer v-if="tool.status === 'waiting'" class="tool-strip__approval">
      <button type="button" @click="decide('deny')">{{ t('deny') }}</button>
      <button type="button" @click="decide('allow-once')">{{ t('allow') }}</button>
      <button class="primary-button" type="button" @click="decide('always-allow')">{{ t('alwaysAllow') }}</button>
    </footer>
  </article>
</template>
