import { test } from 'node:test'
import assert from 'node:assert/strict'
import { History } from '../src/commands/history.js'

const toolMessage = (finished = true) => ({
  history: [
    {
      messageId: 'assistant-1',
      role: 'assistant',
      content: [{
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'read_file',
        input: { path: 'a.txt' },
      }],
    },
    ...(finished ? [{
      messageId: 'tool-1',
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'call-1',
        toolName: 'read_file',
        output: { type: 'text', value: 'ok' },
      }],
    }] : []),
  ],
  toolTimings: {
    'call-1': finished
      ? { startedAt: 1_000, finishedAt: 2_600, durationMs: 1_600 }
      : { startedAt: 1_000 },
  },
})

test('history restores persisted tool start and finish times', () => {
  const session = History.normalize(toolMessage())
  const tool = session.messages.flatMap(message => message.tools || []).find(item => item.id === 'call-1')
  assert.equal(tool.startedAt, 1_000)
  assert.equal(tool.finishedAt, 2_600)
  assert.equal(tool.durationMs, 1_600)
})

test('running tool keeps its persisted start after refresh', () => {
  const session = History.normalize(toolMessage(false))
  const tool = session.messages.flatMap(message => message.tools || []).find(item => item.id === 'call-1')
  assert.equal(tool.startedAt, 1_000)
  assert.equal(tool.finishedAt, 0)
  assert.equal(tool.status, 'running')
})
