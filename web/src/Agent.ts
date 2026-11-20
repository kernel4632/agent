/*
后端 Agent 的前端镜像：一份与 agent-core 相同的响应式历史，加上“此刻正在发生”的几项实时状态。
历史只按 core 的事件追加（core 在什么时候写，这里就在什么时候写）；实时状态只在事件真的到达时出现，
所以界面上看到的永远是真实状态：没收到 request-start 就没有请求条，request-error 一到半截内容就撤掉。

调用示例：
    await Agent.load()
    Agent.send('帮我看看项目', files)   // 发送；Agent.continue() 是不带输入的发送
    Agent.stop(); Agent.compact(); Agent.resend(id, '改写后的问题')
*/

import { reactive } from 'vue'
import type { AssistantMessage, Event, Message, RequestRecord, ToolCall } from '@kernel4632/agent-core'
import { API, type Model } from './api'

// 正在生成的这一条：思考、正文、工具调用按到达顺序排着；工具参数是还没写完的原始文字。
export type LivePart =
  | { type: 'reasoning' | 'text'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: string; call?: ToolCall }
type CompactReason = Extract<Event, { type: 'compact-start' }>['reason']
export interface Live { model: string; start: number; attempt: number; first?: number; compact?: true; parts: LivePart[] }

interface State {
  history: Message[]
  live: Live | null                                  // 只在 request-start 到 request-end / request-error 之间存在
  retry: { attempt: number; until: number } | null   // 两次尝试之间的等待
  runs: Record<string, string>                       // 正在执行的工具 → 实时输出
  compacting: CompactReason | null                   // compact-start 到 compact-end 之间
  running: boolean                                   // send / compact 还没返回
  stopped: boolean                                   // 上一次运行是用户停下的（中性，不算失败）
  fault: string                                      // 推送断了：如实显示，不伪造进度
  model: string; effort?: string; models: Model[]
}

const state: State = reactive({ history: [], live: null, retry: null, runs: {}, compacting: null, running: false, stopped: false, fault: '', model: '', effort: undefined, models: [] })

let compactRequest: RequestRecord | undefined               // 压缩请求的记录，compact-end 时挂到总结上
const id = () => Math.random().toString(36).slice(2, 12)
const parse = (raw: string) => { try { return JSON.parse(raw) } catch { return raw } }

// 一条事件 → 镜像的变化。只有这里写 state.history / state.live。
function receive(event: Event) {
  const live = state.live
  switch (event.type) {
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
      if (event.compact) { compactRequest = event.request; return }
      // core 此刻把回复写进历史：内容就是刚才流出来的这些片段，请求记录挂在上面。
      state.history.push({ id: id(), role: 'assistant', request: event.request, content: (live?.parts ?? []).map(part =>
        part.type === 'tool-call' ? { type: 'tool-call' as const, toolCallId: part.toolCallId, toolName: part.toolName, input: part.call?.input ?? parse(part.input) } : { ...part }) })
      return
    case 'request-error':
      // 失败的尝试不进历史，片段随它作废；core 同时写下一条 role:error。
      state.live = null
      state.history.push({ id: id(), role: 'error', content: event.error.message, request: { kind: event.error.kind, statusCode: event.error.statusCode, model: live?.model, compact: event.compact, ...(event.retry ? { attempt: event.attempt } : { final: true }) } })
      state.retry = event.retry ? { attempt: event.attempt, until: Date.now() + event.retry.delay } : null
      return
    case 'tool-run': state.runs[event.toolCallId] = ''; return
    case 'tool-output': if (event.toolCallId in state.runs) state.runs[event.toolCallId] += event.data; return
    case 'tool-result': {
      const { toolCallId, toolName, output } = event.result
      delete state.runs[toolCallId]
      state.history.push({ id: id(), role: 'tool', content: [{ type: 'tool-result', toolCallId, toolName, output: output as never }] })
      return
    }
    case 'step': {
      // 这一轮已经写进 core 的历史：以 core 的回复内容为准（非流式时前面没有片段，只能靠这里补齐）。
      const reply = event.reply.messages.findLast(message => message.role === 'assistant')
      const mine = state.history.findLast(message => message.role === 'assistant') as AssistantMessage | undefined
      if (reply && mine) mine.content = reply.content as AssistantMessage['content']
      return
    }
    case 'compact-start': state.compacting = event.reason; return
    case 'compact-end':
      state.history.push({ id: id(), role: 'compact', content: event.summary, request: compactRequest })
      state.compacting = null
      compactRequest = undefined
      return
    case 'warning': console.warn('[agent-core]', event.message)
  }
}

// send / compact 共用的收尾：连接结束时，所有“进行中”的状态都随之结束。
async function run(task: () => Promise<void>) {
  Object.assign(state, { running: true, stopped: false, fault: '' })
  try { await task() } catch (error) { if (!state.stopped) state.fault = error instanceof Error ? error.message : String(error) }
  Object.assign(state, { running: false, live: null, retry: null, compacting: null, runs: {} })
}

// 选中的文件 → core 的内容块（图片按 image，其余按 file），文字放最后。
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
  if (cut) state.history.splice(state.history.findIndex(message => message.id === cut))
  if (input !== undefined) state.history.push({ id: id(), role: 'user', content: input })
  return run(() => API.send({ input, cut }, receive))
}

export const Agent = {
  state,
  receive,
  send,
  continue: () => send(),
  resend: (messageId: string, text: string) => send(text, [], messageId),
  compact: () => state.running ? undefined : run(() => API.compact(receive)),
  async stop() { if (!state.running) return; state.stopped = true; await API.stop() },
  async configure(patch: { model?: string; effort?: string }) {
    Object.assign(state, patch)
    // 换模型时思考强度沿用；新模型不支持这一档就退回它的中间档，没有思考强度就清空。
    const efforts = state.models.find(model => model.id === state.model)?.efforts
    if (!efforts?.includes(state.effort ?? '')) state.effort = efforts?.[Math.floor(efforts.length / 2)]
    await API.configure({ model: state.model, effort: state.effort })
  },
  async load() {
    const snapshot = await API.load()
    Object.assign(state, { history: snapshot.history, model: snapshot.model, effort: snapshot.effort, models: snapshot.models })
  },
}
