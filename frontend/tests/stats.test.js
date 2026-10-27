import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estimateTokens, sessionStats } from '../src/session/stats.js'

const user = (content, id = 'u1') => ({ id, role: 'user', content })
const assistant = (content, extra = {}) => ({ id: 'a1', role: 'assistant', content, steps: [{ type: 'text', text: content }], tools: [], ...extra })

test('estimateTokens counts Chinese and English in the same text', () => {
  assert.ok(estimateTokens('你好') > 0)
  assert.ok(estimateTokens('hello world') > 0)
  assert.equal(estimateTokens(''), 0)
  assert.equal(estimateTokens(null), 0)
  // 同样字符数时，中文比英文更“贵”。
  assert.ok(estimateTokens('你好世界你好世界你好世界你好世界') > estimateTokens('abcdefghijklmnopqrst'))
})

test('real request usage wins over estimation', () => {
  const request = { input: 30, output: 20, cache: 10, total: 50, durationMs: 800, startedAt: 1, finishedAt: 801 }
  const session = {
    contextLimit: 1000,
    contextTokens: 30,
    messages: [user('你好'), assistant('好的', { requests: [request], request })],
  }

  const stats = sessionStats(session)

  assert.equal(stats.approximate, false)
  assert.equal(stats.context.used, 30)
  assert.equal(stats.context.limit, 1000)
  assert.equal(stats.usage.input, 30)
  assert.equal(stats.usage.output, 20)
  assert.equal(stats.usage.cacheRead, 10)
  assert.equal(stats.usage.requests, 1)
  assert.equal(stats.usage.messages, 2)
  assert.equal(stats.usage.total, 50)
  assert.equal(stats.usage.durationMs, 800)
  assert.deepEqual(stats.series, [{ input: 30, output: 20 }])
})

test('legacy history without usage is estimated and marked, not shown as zero', () => {
  const session = {
    contextLimit: 128000,
    messages: [
      user('帮我看一下这个项目的结构'),
      assistant('我先读几个文件。', {
        tools: [{ id: 't1', name: 'read_file', input: { path: 'README.md' }, output: { type: 'text', value: '# 项目说明\n这是一个示例项目。' } }],
        steps: [
          { type: 'reasoning', text: '先了解目录，再读 README。' },
          { type: 'tool', toolId: 't1' },
          { type: 'text', text: '我先读几个文件。' },
        ],
      }),
    ],
  }

  const stats = sessionStats(session)

  assert.equal(stats.approximate, true)
  assert.equal(stats.context.approximate, true)
  assert.equal(stats.usage.approximate, true)
  assert.ok(stats.context.used > 0)
  assert.ok(stats.usage.total > 0)
  assert.ok(stats.usage.input > 0)
  assert.ok(stats.usage.output > 0)
  assert.ok(stats.usage.reasoning > 0)
  assert.equal(stats.usage.cacheRead, 0)
  assert.equal(stats.usage.requests, 1)
  assert.deepEqual(stats.series, [])
})

test('an over-limit estimate keeps the real number and marks it', () => {
  const long = '很长的内容'.repeat(4000)
  const session = {
    contextLimit: 1000,
    messages: [user(long), assistant(long)],
  }

  const stats = sessionStats(session)

  assert.equal(stats.approximate, true)
  assert.equal(stats.context.over, true)
  assert.ok(stats.context.used > stats.context.limit)
})

test('context estimation starts after the last compaction mark', () => {
  const long = '旧内容'.repeat(3000)
  const session = {
    contextLimit: 128000,
    messages: [
      user(long, 'u-old'),
      assistant(long),
      { ...user('上次对话的压缩摘要', 'u-compact'), compact: true },
      user('新的问题', 'u-new'),
      assistant('新的回答'),
    ],
  }

  const stats = sessionStats(session)

  // 累计用量保留整段历史，上下文只算最后一次压缩之后的内容。
  assert.ok(stats.usage.total > stats.context.used)
  assert.ok(stats.context.used < 128000)
})

test('estimation is cached until the message list changes', () => {
  const session = {
    contextLimit: 128000,
    messages: [user('你好'), assistant('你好！')],
  }

  const first = sessionStats(session)
  const second = sessionStats(session)
  assert.equal(first.context.used, second.context.used)

  session.messages.push(user('再问一句', 'u2'))
  const third = sessionStats(session)
  assert.ok(third.context.used > first.context.used)
})

test('an empty session has no stats even when the model limit is known', () => {
  assert.equal(sessionStats(null), null)
  assert.equal(sessionStats({ messages: [] }), null)
  assert.equal(sessionStats({ messages: [], contextLimit: 128000 }), null)
})
