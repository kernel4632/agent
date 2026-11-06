<!--
处理过程树：接受“一级过程 + 二级工具/思考组”的分段，渲染成真正的缩进树。
每一行自己画同一套 1px 连线，末端只画到自己的横枝；不再在多个层级分别写伪元素。
调用示例：<ProcessTree :sections="sections" :group-open="groupOpen" :session-id="id" @toggle-group="groupOpen = !groupOpen" />。
-->
<script setup>
import { computed, useId } from 'vue'
import Icon from '../../ui/Icon.vue'
import Markdown from '../../ui/Markdown.vue'
import RequestStatus from '../feedback/RequestStatus.vue'
import ReasoningStep from './ReasoningStep.vue'
import ToolCall from '../activity/ToolCall.vue'

const props = defineProps({
  sections: { type: Array, default: () => [] },
  groupOpen: Boolean,
  sessionId: { type: String, required: true },
})
const emit = defineEmits(['toggle-group'])
const bodyId = `process-body-${useId()}`
// 压缩流一直在追加；停在顶部就看不到最新一行。
const vAutoScroll = {
  mounted: element => { element.scrollTop = element.scrollHeight },
  updated: element => { element.scrollTop = element.scrollHeight },
}

// 把分组展开成扁平行：每行只关心自己的深度、是否是最后一个、父级竖线从哪开始。
const rows = computed(() => {
  const list = []
  props.sections.forEach((section, index) => {
    const isLast = index === props.sections.length - 1
    if (section.type === 'step') {
      const icon = section.step.type === 'reasoning' || section.step.type === 'tool' || section.step.type === 'text'
      list.push({
        key: section.key, step: section.step, depth: 1, isLast, icon,
        nodeX: 24, parentX: 12, elbowY: 22,
      })
      return
    }
    const children = props.groupOpen ? section.steps : []
    list.push({
      key: section.key, section, group: true, depth: 1, isLast, icon: true,
      nodeX: 24, parentX: 12, elbowY: 18,
      subtree: children.length > 0,
    })
    children.forEach((step, childIndex) => {
      const childLast = childIndex === children.length - 1
      list.push({
        key: step.key, step, depth: 2, isLast: childLast, icon: true,
        nodeX: 48, parentX: 36, elbowY: 22,
      })
    })
  })
  return list
})

const line = row => ({
  '--stem-end': `${row.elbowY}px`,
})
</script>

<template>
  <div :id="bodyId" class="cot-steps process-rows">
    <div
      v-for="row in rows" :key="row.key" class="process-row"
      :class="{ 'is-group': row.group, 'has-children': row.subtree }"
    >
      <span class="process-line process-line--v process-line--stem" :class="{ 'is-last': row.isLast }" :style="{ left: `${row.parentX}px`, ...line(row) }"></span>
      <span class="process-line process-line--h" :style="{ left: `${row.parentX}px`, top: `${row.elbowY}px`, width: `${(row.icon ? row.nodeX + 12 : row.nodeX) - row.parentX}px` }"></span>
      <span v-if="row.subtree" class="process-line process-line--v process-line--subtree" :style="{ left: `${row.nodeX + 12}px`, top: `${row.elbowY}px` }"></span>

      <div class="process-row__body" :style="{ marginLeft: `${row.nodeX}px` }">
        <button v-if="row.group" type="button" class="process-group__head" :aria-expanded="groupOpen" @click="emit('toggle-group')">
          <span class="process-group__icon"><Icon name="layers" :size="14" /></span>
          <span class="process-group__title">工具与思考</span>
          <em>{{ row.section.steps.length }} 项</em>
          <Icon name="down" :size="14" class="process-group__caret" :class="{ 'is-open': groupOpen }" aria-hidden="true" />
        </button>

        <RequestStatus v-else-if="row.step.type === 'request'" :data-message-id="row.step.messageId" :request="row.step.request" />
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
  </div>
</template>

<style scoped lang="scss" src="../../styles/components/conversation/ProcessTree.scss"></style>
