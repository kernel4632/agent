import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import type { Event, Message } from '@kernel4632/agent-core'
import { Agent } from '../src/Agent'
import { API, type Push, type Snapshot } from '../src/api'

// 通过 spyOn(API, 'connect') 捕获 Agent 内部的 apply / receive / push 回调，无需改动业务导出。
function bindChannel() {
  let onSnapshot!: (snapshot: Snapshot) => void
  let onEvent!: (event: Event) => void
  let onPush!: Push
  const spy = spyOn(API, 'connect').mockImplementation((_id, apply, receive, push) => {
    onSnapshot = apply
    onEvent = receive
    onPush = push
    return () => {}
  })
  Agent.connect('test')
  spy.mockRestore()
  return { onSnapshot, onEvent, onPush }
}

afterEach(() => {
  const { onSnapshot } = bindChannel()
  onSnapshot({ history: [], tail: [], running: false, model: '', models: [] })
  Agent.push = undefined
})

describe('Agent', () => {
  test('request-start 初始化 live，相邻同类 reasoning/text 片段自动合并，request-end 清空 live', () => {
    Agent.receive({ type: 'request-start', model: 'm1', start: 1000, attempt: 1 })
    expect(Agent.state.live).toEqual({ model: 'm1', start: 1000, attempt: 1, compact: undefined, parts: [] })

    Agent.receive({ type: 'reasoning', text: '先想' })
    Agent.receive({ type: 'reasoning', text: '一步' })
    Agent.receive({ type: 'text', text: '你好' })
    Agent.receive({ type: 'text', text: '世界' })

    expect(Agent.state.live?.first).toBeNumber()
    expect(Agent.state.live?.parts).toEqual([
      { type: 'reasoning', text: '先想一步' },
      { type: 'text', text: '你好世界' },
    ])

    Agent.receive({ type: 'request-end', duration: 10 } as Event)
    expect(Agent.state.live).toBeNull()
  })

  test('tool-input-start / tool-input / tool-call 与 tool-run / tool-output / tool-result 正确归并', () => {
    Agent.receive({ type: 'request-start', model: 'm1', start: 2000, attempt: 1 })
    Agent.receive({ type: 'tool-input-start', toolCallId: 'tc1', toolName: 'read_file' })
    Agent.receive({ type: 'tool-input', toolCallId: 'tc1', delta: '{"path":' })
    Agent.receive({ type: 'tool-input', toolCallId: 'tc1', delta: '"a.txt"}' })
    expect(Agent.state.live?.parts).toEqual([
      { type: 'tool-call', toolCallId: 'tc1', toolName: 'read_file', input: '{"path":"a.txt"}' },
    ])

    const call = { type: 'tool-call' as const, toolCallId: 'tc1', toolName: 'read_file', input: { path: 'a.txt' } }
    Agent.receive({ type: 'tool-call', call })
    // 未先收到 tool-input-start 时也能直接补齐 tool-call
    const direct = { type: 'tool-call' as const, toolCallId: 'tc2', toolName: 'list_dir', input: { path: '.' } }
    Agent.receive({ type: 'tool-call', call: direct })
    expect(Agent.state.live?.parts).toEqual([
      { type: 'tool-call', toolCallId: 'tc1', toolName: 'read_file', input: '{"path":"a.txt"}', call },
      { type: 'tool-call', toolCallId: 'tc2', toolName: 'list_dir', input: '{"path":"."}', call: direct },
    ])

    Agent.receive({ type: 'tool-run', toolCallId: 'tc1' })
    Agent.receive({ type: 'tool-output', toolCallId: 'tc1', data: 'line1\n' })
    Agent.receive({ type: 'tool-output', toolCallId: 'tc1', data: 'line2' })
    expect(Agent.state.runs.tc1).toBe('line1\nline2')

    Agent.receive({ type: 'tool-result', result: { type: 'tool-result', toolCallId: 'tc1', toolName: 'read_file', output: { type: 'text', value: 'ok' } } })
    expect('tc1' in Agent.state.runs).toBe(false)
  })

  test('request-error 记录重试倒计时；compact-start / compact-end 更新压缩状态', () => {
    Agent.receive({ type: 'request-start', model: 'm1', start: 3000, attempt: 1 })
    Agent.receive({ type: 'request-error', attempt: 1, error: new Error('rate limit'), retry: { delay: 5000 } } as unknown as Event)
    expect(Agent.state.live).toBeNull()
    expect(Agent.state.retry?.attempt).toBe(1)
    expect(Agent.state.retry?.until).toBeGreaterThan(Date.now() - 1000)

    Agent.receive({ type: 'compact-start', reason: 'auto' })
    expect(Agent.state.compacting).toBe('auto')
    Agent.receive({ type: 'compact-end' } as Event)
    expect(Agent.state.compacting).toBeNull()
  })

  test('snapshot 恢复历史并重放 tail；push 处理 run 与 cut 帧并透传自定义事件', () => {
    const { onSnapshot, onPush } = bindChannel()
    const userMsg: Message = { id: 'u1', role: 'user', content: 'hi' }
    const assistantMsg: Message = { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'hello' }] }

    onSnapshot({
      history: [userMsg],
      tail: [
        { type: 'request-start', model: 'm1', start: 4000, attempt: 1 },
        { type: 'text', text: '正在输入' },
      ],
      running: true,
      model: 'm1',
      models: [],
    })
    expect(Agent.state.history).toEqual([userMsg])
    expect(Agent.state.running).toBe(true)
    expect(Agent.state.live?.parts).toEqual([{ type: 'text', text: '正在输入' }])

    Agent.receive({ type: 'message', message: assistantMsg })
    expect(Agent.state.history).toEqual([userMsg, assistantMsg])

    onPush('cut', { messageId: 'a1' })
    expect(Agent.state.history).toEqual([userMsg])

    onPush('run', { state: 'stopped' })
    expect(Agent.state.running).toBe(false)
    expect(Agent.state.stopped).toBe(true)
    expect(Agent.state.live).toBeNull()

    const custom: Array<[string, unknown]> = []
    Agent.push = (name, data) => custom.push([name, data])
    onPush('todo.update', { count: 2 })
    expect(custom).toEqual([['todo.update', { count: 2 }]])
  })
})
