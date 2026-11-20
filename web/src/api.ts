/*
唯一请求出口：页面和 Agent 只经过这里跟后端说话，流式推送也从这里进来。
推送的每一条就是 agent-core 的原始事件（onEvent 收到什么就是什么），这里只负责解 SSE，不改内容。
后端还会重写，地址先按“一个 Agent 一组接口”约定；演示模式由 demo.ts 整体替换这些方法，页面不感知。

调用示例：
    const snapshot = await API.load()
    await API.send({ input: '你好' }, event => Agent.receive(event))
    await API.stop()
*/

import type { Event, Input, Message } from '@kernel4632/agent-core'

// 一个可选的模型：efforts 是它支持的思考强度，不支持就没有这一项。
export interface Model { id: string; name: string; efforts?: string[]; context?: number }

// 打开页面时要的全部状态：已保存的历史 + 当前模型和可选模型。
export interface Snapshot { history: Message[]; model: string; effort?: string; models: Model[] }

// 一个扩展的前端入口：加载器按顺序 import 它的 url。
export interface ExtensionEntry { name: string; url: string }

export type Listener = (event: Event) => void

// 发一个请求，把返回的 SSE 逐条交给 listener，直到后端关闭连接。
async function stream(path: string, body: unknown, listener: Listener) {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok || !response.body) throw new Error(`${path} ${response.status}`)
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) return
    buffer += value
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''
    for (const block of blocks) {
      const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')
      if (data) listener(JSON.parse(data) as Event)
    }
  }
}

async function post<T>(path: string, body: unknown = {}): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`${path} ${response.status}`)
  return response.json() as Promise<T>
}

export const API = {
  // 已保存的历史和模型配置。
  load: (): Promise<Snapshot> => fetch('/api/agent').then(response => response.json()),
  // 发送或继续（input 省略 = 继续）；cut 有值时先把历史截到这条用户消息之前再发（改写重发）。
  send: (body: { input?: Input; cut?: string }, listener: Listener): Promise<void> => stream('/api/agent/send', body, listener),
  // 手动压缩，同样经推送回来 compact-start … compact-end。
  compact: (listener: Listener): Promise<void> => stream('/api/agent/compact', {}, listener),
  stop: (): Promise<void> => post('/api/agent/stop'),
  // 换模型或思考强度：下一次请求生效。
  configure: (patch: { model?: string; effort?: string }): Promise<void> => post('/api/agent/configure', patch),
  // 正在生效的扩展前端入口（已按依赖排好序）。
  extensions: (): Promise<ExtensionEntry[]> => fetch('/api/extensions').then(response => response.json()),
}
