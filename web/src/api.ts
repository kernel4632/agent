/*
唯一请求出口：页面和 Agent 只经过这里跟后端说话。
唯一推送通道是 GET /api/agent/:id/stream（SSE）：连上（含重连）先发 snapshot，再按 event 名分发 core / run / 扩展推送。
send / compact / stop / configure 都是普通 POST，不再从响应体读流。

调用示例：
    const stop = API.connect('main', onSnapshot, onEvent, onPush)
    await API.send({ input: '你好' })
    await API.op('permission.answer', { requestId, allow: true })
*/

import type { Event, Input, Message } from '@kernel4632/agent-core'

export interface Model { id: string; name: string; efforts?: string[]; context?: number }

export interface Snapshot {
  history: Message[]
  tail: Event[]
  running: boolean
  retryUntil?: number
  model: string
  effort?: string
  models: Model[]
}

export interface ExtensionEntry { name: string; url: string }
export type Listener = (event: Event) => void
export type Push = (name: string, data: any) => void

let current = 'main'
const base = (id: string, path: string) => `/api/agent/${id}${path}`

async function post<T>(path: string, body: unknown = {}): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`${path} ${response.status}`)
  return response.json() as Promise<T>
}

// 读一条 SSE 长连接，按 event 名把 data 交给 handler；连接被关闭时返回。
async function read(response: Response, handler: (name: string, data: any) => void, signal: AbortSignal) {
  if (!response.ok || !response.body) throw new Error(`${response.url} ${response.status}`)
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  while (!signal.aborted) {
    const { value, done } = await reader.read()
    if (done) return
    buffer += value
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''
    for (const block of blocks) {
      const name = block.match(/^event: (.+)$/m)?.[1]
      const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')
      if (name && data) handler(name, JSON.parse(data))
    }
  }
}

export const API = {
  id: () => current,

  // 打开唯一推送通道。断线后自动重连并重新收到快照。返回关闭函数。
  connect(id: string, onSnapshot: (snapshot: Snapshot) => void, onEvent: Listener, onPush: Push): () => void {
    current = id
    let closed = false
    let abort = new AbortController()
    const open = async () => {
      while (!closed) {
        abort = new AbortController()
        try {
          const response = await fetch(base(id, '/stream'), { signal: abort.signal, headers: { accept: 'text/event-stream' } })
          await read(response, (name, data) => {
            if (name === 'snapshot') onSnapshot(data as Snapshot)
            else if (name === 'core') onEvent(data as Event)
            else onPush(name, data)
          }, abort.signal)
        } catch (error) {
          if (closed || abort.signal.aborted) return
          if (error instanceof Error && error.name === 'AbortError') return
        }
        if (!closed) await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
    void open()
    return () => { closed = true; abort.abort() }
  },

  send: (body: { input?: Input; cut?: string }): Promise<{ ok: true }> => post(base(current, '/send'), body),
  compact: (): Promise<{ ok: true }> => post(base(current, '/compact')),
  stop: (): Promise<unknown> => post(base(current, '/stop')),
  configure: (patch: { model?: string; effort?: string }): Promise<void> => post(base(current, '/configure'), patch),
  extensions: (): Promise<ExtensionEntry[]> => fetch('/api/extensions').then(response => response.json()),
  op: (name: string, body: unknown = {}): Promise<unknown> => post(`/api/op/${name}`, body),
}
