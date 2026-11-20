<!--
对话流：直接对应 agent-core 的历史，不另造“回合”“步骤”。
History.group 是导出的纯函数，把历史和实时状态排成要显示的条目；扩展 patch 它就能改整个显示结构。
规则：模型没说话的思考和工具调用收进同一个 Process；每次请求在 Process 里先放一条 RequestStatus；
正文单独成段；工具结果按 toolCallId 挂到对应调用上；连续的重试报错合成一条 ErrorMessage。
调用示例：<component :is="Components.History" />
-->
<script lang="ts">
import type { CompactMessage, ErrorMessage, Message, RequestRecord } from '@kernel4632/agent-core'
import { Agent, type Live, type LivePart } from '../Agent'

export type ToolState = 'writing' | 'waiting' | 'running' | 'done' | 'failed' | 'denied' | 'cancelled'
export type Step =
  | { kind: 'request'; key: string; request?: RequestRecord; compact?: boolean; live?: Live; errors?: ErrorMessage[]; retry?: { attempt: number; until: number } }
  | { kind: 'thinking'; key: string; text: string; live: boolean }
  | { kind: 'tool'; key: string; name: string; input: unknown; raw?: string; output?: any; log?: string; state: ToolState }
export type Item =
  | { kind: 'user'; key: string; message: Message }
  | { kind: 'process'; key: string; steps: Step[]; live: boolean }
  | { kind: 'assistant'; key: string; text: string; live: boolean }
  | { kind: 'error'; key: string; errors: ErrorMessage[]; text?: string; stopped?: boolean }
  | { kind: 'compact'; key: string; message?: CompactMessage; reason?: string; text?: string }

const LIVE: ToolState[] = ['writing', 'waiting', 'running']
const busy = (step: Step) => step.kind === 'request' ? Boolean(step.live || step.retry) : step.kind === 'thinking' ? step.live : LIVE.includes(step.state)

function group(state: typeof Agent.state): Item[] {
  const items: Item[] = []
  const outputs = new Map<string, any>()
  for (const message of state.history) if (message.role === 'tool') for (const part of message.content) if (part.type === 'tool-result') outputs.set(part.toolCallId, part.output)
  let steps: Step[] = []
  const flush = () => { if (steps.length) items.push({ kind: 'process', key: steps[0]!.key, steps, live: steps.some(busy) }); steps = [] }
  const settled = (id: string): ToolState => {
    const output = outputs.get(id)
    if (output) return output.type === 'execution-denied' ? 'denied' : String(output.type).startsWith('error') ? 'failed' : 'done'
    return id in state.runs ? 'running' : state.running ? 'waiting' : 'cancelled'
  }
  // 一条消息（或正在生成的那一条）的内容块：思考、工具进 Process，正文打断 Process 单独成段。
  const add = (parts: (LivePart | any)[], key: string, live: boolean) => parts.forEach((part, index) => {
    const at = `${key}-${index}`
    const last = live && index === parts.length - 1
    if (part.type === 'reasoning' && part.text.trim()) steps.push({ kind: 'thinking', key: at, text: part.text, live: last })
    if (part.type === 'text' && part.text.trim()) { flush(); items.push({ kind: 'assistant', key: at, text: part.text, live: last }) }
    if (part.type === 'tool-call') steps.push(live
      ? { kind: 'tool', key: part.toolCallId, name: part.toolName, input: part.call?.input, raw: part.input, state: part.call ? 'waiting' : 'writing' }
      : { kind: 'tool', key: part.toolCallId, name: part.toolName, input: part.input, output: outputs.get(part.toolCallId), log: state.runs[part.toolCallId], state: settled(part.toolCallId) })
  })

  for (const message of state.history) {
    const tail = steps.at(-1)
    if (message.role === 'user') { flush(); items.push({ kind: 'user', key: message.id, message }) }
    if (message.role === 'assistant') {
      const key = message.request ? `r${message.request.start}` : message.id
      steps.push({ kind: 'request', key, request: message.request })
      add(typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content, key, false)
    }
    if (message.role === 'error') {
      const retried = tail?.kind === 'request' && tail.errors ? tail.errors : []
      if ((message.request as { final?: boolean } | undefined)?.final) {
        if (retried.length) steps.pop()
        flush()
        items.push({ kind: 'error', key: message.id, errors: [...retried, message] })
      } else if (retried.length) retried.push(message)
      else steps.push({ kind: 'request', key: message.id, errors: [message] })
    }
    if (message.role === 'compact') {
      if (message.request) steps.push({ kind: 'request', key: `r${message.request.start}`, request: message.request, compact: true })
      flush()
      items.push({ kind: 'compact', key: message.id, message })
    }
  }

  // 实时部分：等待重试、正在压缩、正在生成，只在对应事件真的到了才出现。
  const tail = steps.at(-1)
  if (state.retry && tail?.kind === 'request' && tail.errors) tail.retry = state.retry
  const live = state.live
  if (live) steps.push({ kind: 'request', key: `r${live.start}`, live })
  if (state.compacting) { flush(); items.push({ kind: 'compact', key: 'compacting', reason: state.compacting, text: live?.parts.map(part => part.type === 'text' ? part.text : '').join('') }) }
  else if (live) add(live.parts, `r${live.start}`, true)
  flush()
  if (!state.running && state.stopped) items.push({ kind: 'error', key: 'stopped', errors: [], stopped: true })
  if (state.fault) items.push({ kind: 'error', key: 'fault', errors: [], text: `连接中断：${state.fault}` })
  return items
}

export const History = { group }
</script>

<script setup lang="ts">
import { computed } from 'vue'
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
