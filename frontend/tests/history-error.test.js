/*
 * 失败请求历史：role:'error' 只投影成请求行，不显示成 assistant 正文。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { History } from '../src/features/history.js'

const source = {
  id: 'error-fixture',
  provider: 'test',
  model: 'test-model',
  settings: { reasoning: 'auto' },
  history: [
    { messageId: 'u1', id: 'u1', role: 'user', content: '做点事' },
    {
      messageId: 'e1',
      id: 'e1',
      role: 'error',
      content: '模型请求失败：400',
      request: {
        provider: 'test',
        model: 'test-model',
        startedAt: 1000,
        finishedAt: 2500,
        durationMs: 1500,
        error: '模型请求失败：400',
      },
    },
  ],
}

test('failed request history becomes a failed request row, not assistant text', () => {
  const session = History.normalize(source)
  assert.equal(session.messages.length, 2)
  const message = session.messages.at(-1)
  assert.equal(message.role, 'assistant')
  assert.equal(message.content, '')
  assert.equal(message.failedRequest, true)
  assert.equal(message.requests.length, 1)
  assert.equal(message.requests[0].status, 'failed')
  assert.equal(message.requests[0].durationMs, 1500)
  assert.match(message.requests[0].error, /400/)
  assert.deepEqual(message.steps, [{ type: 'request', requestId: 'request_e1' }])
})
