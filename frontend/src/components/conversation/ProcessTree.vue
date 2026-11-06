<!--
处理过程列表：按发生顺序显示请求、正文、思考和工具；只靠缩进区分正文与处理步骤。
不做树线、不做二级分组，折叠摘要由 AssistantTurn 提供。
调用示例：<ProcessTree :steps="treeSteps" :session-id="id" />。
-->
<script setup>
import { computed } from 'vue'
import Icon from '../../ui/Icon.vue'
import Markdown from '../../ui/Markdown.vue'
import RequestStatus from '../feedback/RequestStatus.vue'
import ReasoningStep from './ReasoningStep.vue'
import ToolCall from '../activity/ToolCall.vue'

const props = defineProps({
  steps: { type: Array, default: () => [] },
  sessionId: { type: String, required: true },
})

// 压缩流一直在追加；停在顶部就看不到最新一行。
const vAutoScroll = {
  mounted: element => { element.scrollTop = element.scrollHeight },
  updated: element => { element.scrollTop = element.scrollHeight },
}

// 正文/请求保持原缩进；思考与工具缩进一级，表示它们是“处理步骤”。
const rows = computed(() => props.steps.map(step => ({
  key: step.key,
  step,
  process: step.type === 'reasoning' || step.type === 'tool',
})))
</script>

<template>
  <div class="cot-steps process-rows">
    <div v-for="row in rows" :key="row.key" class="process-row" :class="{ 'is-process-step': row.process }">
      <RequestStatus v-if="row.step.type === 'request'" :data-message-id="row.step.messageId" :request="row.step.request" />
      <template v-else-if="row.step.type === 'compact'">
        <RequestStatus :data-message-id="row.step.messageId" :request="row.step.request" kind="compact" />
        <pre v-if="row.step.request.content || row.step.request.reasoning" v-auto-scroll class="compact-stream">{{ row.step.request.content || row.step.request.reasoning }}</pre>
      </template>
      <ReasoningStep
        v-else-if="row.step.type === 'reasoning'"
        :data-message-id="row.step.messageId"
        :reasoning="row.step.text"
        :streaming="row.step.streaming"
        :started-at="row.step.message.startedAt"
        :finished-at="row.step.message.finishedAt"
      />
      <div v-else-if="row.step.type === 'text'" :data-message-id="row.step.messageId" class="cot-step cot-step--text">
        <span class="cot-step__icon"><Icon name="chat" :size="16" /></span>
        <div class="cot-step__main">
          <div class="cot-step__body cot-step__body--text">
            <Markdown smooth :content="row.step.text" compact />
          </div>
        </div>
      </div>
      <ToolCall
        v-else
        :data-message-id="row.step.messageId"
        :tool="row.step.tool"
        :session-id="sessionId"
      />
    </div>
  </div>
</template>

<style scoped lang="scss" src="../../styles/components/conversation/ProcessTree.scss"></style>
