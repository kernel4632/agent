<!--
  通用工具结果：所有工具共用参数与返回内容区域，不登记按工具类型划分的前端视图。
  文本直接显示，对象按 JSON 展示；标题、状态和审批仍由 ToolCall 负责。
  调用示例：<ToolResult :tool="tool" />
-->
<script setup>
import { Notice } from '../../commands/notice.js'
import { copyText } from '../../utils/clipboard.js'
import Icon from '../../ui/Icon.vue'
import Button from '../../ui/Button.vue'
import { computed } from 'vue'
import { outputText, actionTarget, toolActions } from '../../commands/tool.js'


const props = defineProps({ tool: { type: Object, required: true } })

const input = computed(() => Object.keys(props.tool.input || {}).length ? JSON.stringify(props.tool.input, null, 2) : '') // 同一套参数显示支持新工具
const result = computed(() => outputText(props.tool)) // 输出包装和流式预览由功能代码统一解释
const actions = computed(() => toolActions(props.tool)) // 保留工具声明的复制、打开动作

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
    <section v-if="input" class="tool-content" aria-label="输入参数">
      <h4>输入参数</h4>
      <pre class="tool-output tool-input">{{ input }}</pre>
    </section>
    <section v-if="result" class="tool-content" aria-label="返回内容">
      <h4>返回内容</h4>
      <pre class="tool-output tool-result" :class="{ 'is-error': tool.status === 'error' || tool.status === 'rejected' }">{{ result }}</pre>
    </section>
    <p v-else class="tool-empty">{{ tool.status === 'completed' ? '工具没有返回内容' : tool.status === 'rejected' ? '本次调用已被拒绝' : tool.status === 'error' ? '工具执行失败，未返回错误详情' : '等待工具结果…' }}</p>
    <div v-if="actions.length" class="tool-actions">
      <Button v-for="action in actions" :key="action.id" variant="ghost" size="small" @click="run(action)">
        <Icon v-if="action.icon" :name="action.icon" :size="13" />{{ action.label }}
      </Button>
    </div>
  </div>
</template>

<style scoped lang="scss" src="../../styles/components/activity/ToolResult.scss"></style>
