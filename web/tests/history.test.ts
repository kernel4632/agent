import { describe, expect, test } from 'bun:test'
import type { ErrorMessage, Message } from '@kernel4632/agent-core'
import { Agent } from '../src/Agent'
import { group } from '../src/history'

type TestState = typeof Agent.state

function makeState(patch: Partial<TestState> = {}): TestState {
  return {
    history: [],
    live: null,
    retry: null,
    runs: {},
    compacting: null,
    running: false,
    stopped: false,
    fault: '',
    model: '',
    effort: undefined,
    models: [],
    extras: {},
    ...patch,
  }
}

describe('History.group', () => {
  test('空状态返回空数组', () => {
    expect(group(makeState())).toEqual([])
  })

  test('思考与工具收进同一个 Process，正文打断 Process 单独成段', () => {
    const history: Message[] = [
      { id: 'u1', role: 'user', content: '帮我看下文件' },
      {
        id: 'a1',
        role: 'assistant',
        request: { model: 'm1', start: 100, duration: 20, usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 } },
        content: [
          { type: 'reasoning', text: '先读文件' },
          { type: 'tool-call', toolCallId: 'tc1', toolName: 'read_file', input: { path: 'a.txt' } },
          { type: 'text', text: '文件内容如下' },
        ],
      },
      {
        id: 't1',
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 'tc1', toolName: 'read_file', output: { type: 'text', value: 'abc' } },
        ],
      },
    ]

    const items = group(makeState({ history }))
    expect(items.map(item => item.kind)).toEqual(['user', 'process', 'assistant'])
    expect(items[1]).toMatchObject({
      kind: 'process',
      live: false,
      steps: [
        { kind: 'request', key: 'r100' },
        { kind: 'thinking', text: '先读文件', live: false },
        { kind: 'tool', key: 'tc1', name: 'read_file', state: 'done', output: { type: 'text', value: 'abc' } },
      ],
    })
    expect(items[2]).toEqual({ kind: 'assistant', key: 'r100-2', text: '文件内容如下', live: false })
  })

  test('工具调用状态按输出、runs、running 正确区分 done / failed / denied / running / waiting / cancelled', () => {
    const assistant = (id: string, toolCallId: string): Message => ({
      id,
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId, toolName: 'shell', input: {} }],
    })
    const toolResult = (id: string, toolCallId: string, outputType: string): Message => ({
      id,
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId, toolName: 'shell', output: { type: outputType, value: 'x' } as any }],
    })

    const baseHistory: Message[] = [
      assistant('a1', 't-done'),
      toolResult('r1', 't-done', 'text'),
      assistant('a2', 't-fail'),
      toolResult('r2', 't-fail', 'error-text'),
      assistant('a3', 't-deny'),
      toolResult('r3', 't-deny', 'execution-denied'),
      assistant('a4', 't-run'),
      assistant('a5', 't-pend'),
    ]

    const whileRunning = group(makeState({ history: baseHistory, runs: { 't-run': 'stdout' }, running: true }))
    const processRunning = whileRunning[0]!
    expect(processRunning.kind).toBe('process')
    if (processRunning.kind === 'process') {
      const states = processRunning.steps.filter(step => step.kind === 'tool').map(step => step.state)
      expect(states).toEqual(['done', 'failed', 'denied', 'running', 'waiting'])
    }

    const afterStop = group(makeState({ history: baseHistory, running: false }))
    const processStopped = afterStop[0]!
    if (processStopped.kind === 'process') {
      const states = processStopped.steps.filter(step => step.kind === 'tool').map(step => step.state)
      expect(states).toEqual(['done', 'failed', 'denied', 'cancelled', 'cancelled'])
    }
  })

  test('连续重试报错合并到 request，遇到 final 错误后收拢为独立 error 条目', () => {
    const err1: ErrorMessage = { id: 'e1', role: 'error', content: '429', request: { model: 'm1', start: 1, duration: 1 } }
    const err2: ErrorMessage = { id: 'e2', role: 'error', content: '503', request: { model: 'm1', start: 2, duration: 1 } }
    const finalErr: ErrorMessage = { id: 'e3', role: 'error', content: 'failed', request: { model: 'm1', start: 3, duration: 1, final: true } as any }

    const retrying = group(makeState({ history: [err1, err2], retry: { attempt: 2, until: 99999 } }))
    expect(retrying).toHaveLength(1)
    expect(retrying[0]).toMatchObject({
      kind: 'process',
      live: true,
      steps: [{ kind: 'request', key: 'e1', errors: [err1, err2], retry: { attempt: 2, until: 99999 } }],
    })

    const failed = group(makeState({ history: [err1, err2, finalErr] }))
    expect(failed).toEqual([{ kind: 'error', key: 'e3', errors: [err1, err2, finalErr] }])
  })

  test('实时 live、compacting、stopped 与 fault 状态正确映射', () => {
    const liveItems = group(makeState({
      running: true,
      live: {
        model: 'm1',
        start: 500,
        attempt: 1,
        parts: [
          { type: 'reasoning', text: '思考中' },
          { type: 'tool-call', toolCallId: 'tc-live', toolName: 'read_file', input: '{"p' },
        ],
      },
    }))
    expect(liveItems).toHaveLength(1)
    expect(liveItems[0]).toMatchObject({
      kind: 'process',
      live: true,
      steps: [
        { kind: 'request', key: 'r500' },
        { kind: 'thinking', text: '思考中', live: false },
        { kind: 'tool', key: 'tc-live', state: 'writing', raw: '{"p' },
      ],
    })

    const compactAndError = group(makeState({
      compacting: 'manual',
      live: { model: 'm1', start: 600, attempt: 1, parts: [{ type: 'text', text: '摘要中' }] },
      stopped: true,
      fault: '未配置模型',
    }))
    expect(compactAndError).toEqual([
      { kind: 'process', key: 'r600', steps: [{ kind: 'request', key: 'r600', live: { model: 'm1', start: 600, attempt: 1, parts: [{ type: 'text', text: '摘要中' }] } }], live: true },
      { kind: 'compact', key: 'compacting', reason: 'manual', text: '摘要中' },
      { kind: 'error', key: 'stopped', errors: [], stopped: true },
      { kind: 'error', key: 'fault', errors: [], text: '未配置模型' },
    ])
  })
})
