<!--
工具展示条：用易读标题、预览、回退和三选一审批表达一次 Agent 操作。
组件只展示架构规定的信息，审批与回退继续交给对话 Command。
调用示例：<ToolCall :tool="tool" @approval="decide" />。
-->
<script setup>
import { t } from '../../i18n.js'                                    // 引入响应式界面翻译

const props = defineProps({ tool: { type: Object, required: true } }) // 当前工具的输入、预览和状态
const emit = defineEmits(['rollback', 'approval'])                    // 向对话页反馈用户动作
const icons = { read_file: 'description', write_file: 'edit_document', run_command: 'terminal', web_fetch: 'language' } // 每类工具使用可快速辨认的语义图标


// --- 提交审批决定 ---
function decide(decision) {
  emit('approval', { toolCallID: props.tool.id, decision })           // 只传业务身份和决定
}
</script>

<template>
  <m3e-card class="tool-strip" :class="`is-${tool.status}`">
    <div class="tool-strip__line">
      <div class="tool-strip__summary">
        <span class="tool-strip__icon"><m3e-icon :name="icons[tool.name] || 'build'"></m3e-icon></span>
        <strong>{{ tool.title || tool.name }}</strong>
        <span class="tool-strip__preview">{{ tool.preview }}</span>
      </div>
      <m3e-icon-button v-if="tool.checkpoint" :aria-label="t('rollbackHere')" :title="t('rollbackHere')" @click="emit('rollback', tool.checkpoint)"><m3e-icon name="undo"></m3e-icon></m3e-icon-button>
    </div>

    <footer v-if="tool.status === 'waiting'" class="tool-strip__approval">
      <m3e-button class="approval-deny" @click="decide('deny')">{{ t('deny') }}</m3e-button>
      <m3e-button variant="tonal" @click="decide('allow-once')">{{ t('allow') }}</m3e-button>
      <m3e-button variant="filled" @click="decide('always-allow')">{{ t('alwaysAllow') }}</m3e-button>
    </footer>
  </m3e-card>
</template>

<style lang="scss" src="../../styles/components/ToolCall.scss"></style>
