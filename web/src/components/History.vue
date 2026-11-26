<!--
对话流：直接对应 agent-core 的历史，不另造“回合”“步骤”。
History.group 是导出的纯函数，把历史和实时状态排成要显示的条目；扩展 patch 它就能改整个显示结构。
规则：模型没说话的思考和工具调用收进同一个 Process；每次请求在 Process 里先放一条 RequestStatus；
正文单独成段；工具结果按 toolCallId 挂到对应调用上；连续的重试报错合成一条 ErrorMessage。
调用示例：<component :is="Components.History" />
-->
<script lang="ts">
import { group, type Item, type Step, type ToolState } from '../history'

export type { Item, Step, ToolState }
export const History = { group }
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { Agent } from '../Agent'
import { Components } from '../Extension'

const items = computed(() => History.group(Agent.state))
const lastError = computed(() => items.value.findLast(item => item.kind === 'error')?.key)
</script>

<template>
  <div class="history">
    <template v-for="item in items" :key="item.key">
      <component :is="Components.UserMessage" v-if="item.kind === 'user'" :message="item.message" />
      <component :is="Components.Process" v-else-if="item.kind === 'process'" :steps="item.steps" :live="item.live" />
      <component :is="Components.AssistantMessage" v-else-if="item.kind === 'assistant'" :text="item.text" :live="item.live" />
      <component :is="Components.ErrorMessage" v-else-if="item.kind === 'error'" v-bind="item" :last="item.key === lastError && item === items.at(-1)" />
      <component :is="Components.CompactMessage" v-else-if="item.kind === 'compact'" v-bind="item" />
    </template>
  </div>
</template>

<style scoped>
.history { display: flex; flex-direction: column; gap: 20px; }
</style>
