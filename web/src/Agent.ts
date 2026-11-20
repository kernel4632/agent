/*
后端 Agent 的前端镜像：一份与 agent-core 相同的响应式历史，加上“此刻正在发生”的几项实时状态。
历史只按 core 的 message 事件追加（core 写什么，这里就出现什么）；实时状态只在事件真的到达时出现，
所以界面上看到的永远是真实状态：没收到 request-start 就没有请求条，用户消息也等 core 收下才出现。
running / stopped 由推送通道的 run 帧驱动，多个页签看到的是同一份状态。
*/

import { reactive } from 'vue'
import type { Event, Message, ToolCall } from '@kernel4632/agent-core'
import { API, type Push, type Snapshot } from './api'

export type LivePart =
  | { type: 'reasoning' | 'text'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: string; call?: ToolCall }
type CompactReason = Extract<Event, { type: 'compact-start' }>['reason']
export interface Live { model: string; start: number; attempt: number; first?: number; compact?: true; parts: LivePart[] }

interface State {
  history: Message[]
  live: Live | null
  retry: { attempt: number; until: number } | null
  runs: Record<string, string>
  compacting: CompactReason | null
  running: boolean
  stopped: boolean
  fault: string
  model: string; effort?: string; models: Snapshot['models']
  extras: Record<string, unknown>
}

const state: State = reactive({ history: [], live: null, retry: null, runs: {}, compacting: null, running: false, stopped: false, fault: '', model: '', effort: undefined, models: [], extras: {} })

let disconnect: (() => void) | undefined
const clearLive = () => Object.assign(state, { live: null, retry: null, compacting: null, runs: {} })

function apply(snapshot: Snapshot) {
  const { history, tail, running, retryUntil, model, effort, models, ...extras } = snapshot as Snapshot & Record<string, unknown>
  Object.assign(state, { history, model, effort, models, running, stopped: false, fault: '', live: null, runs: {}, compacting: null, retry: retryUntil ? { attempt: 0, until: retryUntil as number } : null, extras })
  for (const event of tail ?? []) receive(event)
}

function push(name: string, data: any) {
  if (name === 'run') {
    if (data.state === 'start') Object.assign(state, { running: true, stopped: false, fault: '' })
    else if (data.state === 'end') { state.running = false; clearLive() }
    else if (data.state === 'stopped') { Object.assign(state, { running: false, stopped: true }); clearLive() }
    else if (data.state === 'error') { Object.assign(state, { running: false, fault: data.message ?? '' }); clearLive() }
    return
  }
  if (name === 'cut') {
    if (data.history) state.history = data.history
    else if (data.messageId) {
      const index = state.history.findIndex(message => message.id === data.messageId)
      if (index >= 0) state.history.splice(index)
    }
    return
  }
  Agent.push?.(name, data)
}

function receive(event: Event) {
  const live = state.live
  switch (event.type) {
    case 'message':
      state.history.push(event.message)
      return
    case 'request-start':
      state.retry = null
      state.live = { model: event.model, start: event.start, attempt: event.attempt, compact: event.compact, parts: [] }
      return
    case 'reasoning': case 'text': {
      if (!live) return
      live.first ??= Date.now() - live.start
      const last = live.parts.at(-1)
      if (last?.type === event.type) last.text += event.text
      else live.parts.push({ type: event.type, text: event.text })
      return
    }
    case 'tool-input-start':
      live?.parts.push({ type: 'tool-call', toolCallId: event.toolCallId, toolName: event.toolName, input: '' })
      return
    case 'tool-input': {
      const part = live?.parts.find(item => item.type === 'tool-call' && item.toolCallId === event.toolCallId)
      if (part?.type === 'tool-call') part.input += event.delta
      return
    }
    case 'tool-call': {
      const found = live?.parts.find(item => item.type === 'tool-call' && item.toolCallId === event.call.toolCallId)
      const part = found ?? { type: 'tool-call' as const, toolCallId: event.call.toolCallId, toolName: event.call.toolName, input: '' }
      if (part.type !== 'tool-call') return
      Object.assign(part, { call: event.call, input: JSON.stringify(event.call.input ?? {}) })
      if (!found) live?.parts.push(part)
      return
    }
    case 'request-end':
      state.live = null
      return
    case 'request-error':
      state.live = null
      state.retry = event.retry ? { attempt: event.attempt, until: Date.now() + event.retry.delay } : null
      return
    case 'tool-run': state.runs[event.toolCallId] = ''; return
    case 'tool-output': if (event.toolCallId in state.runs) state.runs[event.toolCallId] += event.data; return
    case 'tool-result': delete state.runs[event.result.toolCallId]; return
    case 'compact-start': state.compacting = event.reason; return
    case 'compact-end': state.compacting = null; return
    case 'warning': console.warn('[agent-core]', event.message)
  }
}

async function pack(text: string, files: File[]) {
  if (!files.length) return text
  const read = (file: File) => new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file) })
  const parts = await Promise.all(files.map(async file => file.type.startsWith('image/')
    ? { type: 'image' as const, image: await read(file), mediaType: file.type }
    : { type: 'file' as const, data: await read(file), mediaType: file.type || 'application/octet-stream', filename: file.name }))
  return text ? [...parts, { type: 'text' as const, text }] : parts
}

async function send(text = '', files: File[] = [], cut?: string) {
  if (state.running) return
  const input = text || files.length ? await pack(text, files) : undefined
  try { await API.send({ input, cut }) } catch (error) { state.fault = error instanceof Error ? error.message : String(error) }
}

export const Agent = {
  state,
  receive,
  push: undefined as Push | undefined,
  send,
  continue: () => send(),
  resend: (messageId: string, text: string) => send(text, [], messageId),
  compact: () => state.running ? undefined : API.compact().catch(error => { state.fault = error instanceof Error ? error.message : String(error) }),
  async stop() { if (!state.running) return; await API.stop() },
  async configure(patch: { model?: string; effort?: string }) {
    Object.assign(state, patch)
    const efforts = state.models.find(model => model.id === state.model)?.efforts
    if (!efforts?.includes(state.effort ?? '')) state.effort = efforts?.[Math.floor(efforts.length / 2)]
    await API.configure({ model: state.model, effort: state.effort })
  },
  connect(id = 'main') {
    disconnect?.()
    disconnect = API.connect(id, apply, receive, push)
  },
}
