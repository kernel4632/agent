/*
History.group 纯函数实现：把 agent-core 的历史消息与实时状态排成界面渲染条目。
独立为纯 TS 模块以便前端单元测试直接导入，History.vue 对外仍保持相同导出。
*/

import type { CompactMessage, ErrorMessage, Message, RequestRecord } from '@kernel4632/agent-core'
import type { Agent, Live, LivePart } from './Agent'

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

export function group(state: typeof Agent.state): Item[] {
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
  if (state.fault) items.push({ kind: 'error', key: 'fault', errors: [], text: state.fault })
  return items
}
