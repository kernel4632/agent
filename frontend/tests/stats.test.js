/*
 * 会话统计测试：中英文估算、压缩点和请求用量要合成同一份统计。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estimateTokens, sessionStats } from "../src/features/stats.js"

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
  const request = {
    input: 30, output: 20, cache: 10, total: 50, firstTokenMs: 200, generationMs: 800, durationMs: 800,
    provider: 'Test Provider', model: 'test-model', startedAt: 1, finishedAt: 801,
  }
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
  assert.deepEqual(stats.series, [{ input: 30, output: 20, cache: 10 }])
  assert.equal(stats.live.running, false)
  // 外显速度按 output / 整次请求耗时算。
  assert.ok(Math.abs(stats.live.tps - 25) < 0.01)
  assert.deepEqual(stats.models, [{
    provider: 'Test Provider',
    model: 'test-model',
    count: 1,
    averageFirstTokenMs: 200,
    averageDurationMs: 800,
    averageTps: 25,
    recentTps: 25,
    lastFirstTokenMs: 200,
    lastDurationMs: 800,
    lastTps: 25,
    lastAt: 801,
  }])
})

test('frontend raw counters do not override usage output', () => {
  const request = {
    input: 30, output: 100, reasoning: 60, rawOutput: 20, rawTps: 42, generationMs: 800,
    durationMs: 800, firstTokenMs: 200, provider: 'Test Provider', model: 'test-model',
  }
  const session = {
    contextLimit: 1000,
    contextTokens: 30,
    messages: [user('你好'), assistant('好的', { requests: [request], request })],
  }
  const stats = sessionStats(session)
  assert.ok(Math.abs(stats.models[0].lastTps - 100 / 0.8) < 0.01)
  assert.ok(Math.abs(stats.models[0].averageTps - 100 / 0.8) < 0.01)
})

test('tps becomes zero when there is no duration', () => {
  const request = {
    input: 30, output: 50, reasoning: 40, durationMs: 0, firstTokenMs: 0,
    provider: 'Test Provider', model: 'test-model',
  }
  const session = {
    contextLimit: 1000,
    contextTokens: 30,
    messages: [user('你好'), assistant('好的', { requests: [request], request })],
  }
  const stats = sessionStats(session)
  assert.equal(stats.models[0].lastTps, 0)
  assert.equal(stats.live.tps, 0)
})

test('model tps averages the most recent completed rounds', () => {
  const values = [10, 20, 30, 40, 50, 60]
  const requests = values.map((value, index) => ({
    input: 10, output: value, durationMs: 1000, firstTokenMs: 0,
    provider: 'Test Provider', model: 'test-model', finishedAt: index,
  }))
  const session = {
    contextLimit: 1000,
    contextTokens: 10,
    messages: [user('你好'), assistant('好的', { requests, request: requests.at(-1) })],
  }
  const stats = sessionStats(session)
  assert.equal(stats.models[0].lastTps, 60)
  assert.equal(stats.models[0].recentTps, 40)
})

test('content composition separates user, thinking, reply and tool output', () => {
  const tool = {
    id: 'call-1',
    name: 'read_file',
    input: { path: 'a.js' },
    output: { type: 'text', value: 'const answer = 42' },
    preview: 'const answer = 42',
    status: 'completed',
  }
  const session = {
    contextLimit: 1000,
    contextTokens: 30,
    messages: [
      user('请读一下这个文件'),
      assistant('', {
        steps: [
          { type: 'reasoning', text: '先看看文件内容' },
          { type: 'text', text: '文件里是答案。' },
          { type: 'tool', toolId: 'call-1' },
        ],
        tools: [tool],
        requests: [{ input: 30, output: 20, total: 50, durationMs: 800, firstTokenMs: 200 }],
      }),
    ],
  }
  const stats = sessionStats(session)
  assert.ok(stats.composition.user > 0)
  assert.ok(stats.composition.thinking > 0)
  assert.ok(stats.composition.reply > 0)
  assert.ok(stats.composition.tools > 0)
  assert.equal(stats.composition.total, stats.composition.user + stats.composition.thinking + stats.composition.reply + stats.composition.tools)
})

test('content composition refreshes when a streaming message settles', () => {
  const message = assistant('短', { isStreaming: true, requests: [{ input: 10, output: 1, total: 11 }] })
  const session = { contextLimit: 1000, contextTokens: 10, messages: [user('开始'), message] }
  const before = sessionStats(session).composition.reply
  message.content = '一段长得多的最终回答'.repeat(20)
  message.steps[0].text = message.content
  assert.equal(sessionStats(session).composition.reply, before)
  message.isStreaming = false
  assert.ok(sessionStats(session).composition.reply > before)
})

test('streaming output exposes a live speed snapshot', () => {
  const firstTokenAt = Date.now() - 1000
  const session = {
    contextLimit: 1000,
    contextTokens: 30,
    messages: [user('写一段'), assistant('已经生成了一段内容，正在继续输出', {
      isStreaming: true,
      request: { status: 'running', startedAt: firstTokenAt - 200, firstTokenAt, output: 0, durationMs: 0, input: 30, cache: 0, cacheWrite: 0, total: 0 },
    })],
  }
  const stats = sessionStats(session)
  assert.equal(stats.live.running, true)
  assert.equal(stats.live.firstTokenAt, firstTokenAt)
  assert.ok(stats.live.output > 0)
})

test('speed groups by provider and model, slowest first', () => {  const fast = { input: 10, output: 10, total: 20, firstTokenMs: 300, generationMs: 1000, durationMs: 1000, provider: 'Provider A', model: 'fast-model' }
  const slow = { input: 10, output: 10, total: 20, firstTokenMs: 900, generationMs: 4000, durationMs: 4000, provider: 'Provider B', model: 'slow-model' }
  const session = {
    contextLimit: 1000,
    contextTokens: 10,
    messages: [user('比较一下速度'), assistant('好', { requests: [fast, slow], request: slow })],
  }

  const stats = sessionStats(session)
  assert.deepEqual(stats.models.map(item => `${item.provider}/${item.model}`), ['Provider B/slow-model', 'Provider A/fast-model'])
  assert.equal(stats.models[0].averageTps, 10 / 4)
  assert.equal(stats.models[0].averageDurationMs, 4000)
  assert.equal(stats.models[1].averageTps, 10)
})


test('speed groups keep the latest request alongside averages', () => {
  const first = { input: 10, output: 10, total: 20, firstTokenMs: 300, generationMs: 1000, durationMs: 1000, provider: 'Provider A', model: 'fast-model' }
  const latest = { input: 10, output: 20, total: 30, firstTokenMs: 400, generationMs: 2000, durationMs: 2000, provider: 'Provider A', model: 'fast-model' }
  const session = {
    contextLimit: 1000,
    contextTokens: 10,
    messages: [user('比较一下速度'), assistant('好', { requests: [first, latest], request: latest })],
  }

  const stats = sessionStats(session)
  assert.equal(stats.models[0].count, 2)
  assert.equal(stats.models[0].averageDurationMs, 1500)
  assert.equal(stats.models[0].lastFirstTokenMs, 400)
  assert.equal(stats.models[0].lastDurationMs, 2000)
  assert.equal(stats.models[0].lastTps, 10)
})


test('speed groups keep the last measured first token when the newest request omits it', () => {
  const measured = { input: 10, output: 10, total: 20, firstTokenMs: 7800, generationMs: 200, durationMs: 8000, provider: 'Provider A', model: 'fast-model' }
  const incomplete = { input: 20, output: 20, total: 40, firstTokenMs: 0, generationMs: 2000, durationMs: 2000, provider: 'Provider A', model: 'fast-model' }
  const session = {
    contextLimit: 1000,
    contextTokens: 20,
    messages: [user('切换模型'), assistant('继续', { requests: [measured, incomplete], request: incomplete })],
  }

  const stats = sessionStats(session)
  assert.equal(stats.models[0].lastFirstTokenMs, 7800)
  assert.equal(stats.models[0].lastTps, 10)
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
  assert.equal(stats.series.length, 1)
  assert.ok(stats.series[0].input > 0)
  assert.ok(stats.series[0].output > 0)
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

// 供应商发来的脏用量不能污染统计：面板曾显示成 908.7M tokens。
test('dirty token counts are dropped instead of summed', () => {
  const dirty = { input: 908_700_000, output: 0, total: 908_700_000, provider: 'p', model: 'm' }
  const good = { input: 30, output: 20, total: 50, provider: 'p', model: 'm' }
  const session = {
    contextLimit: 128000,
    contextTokens: 30,
    messages: [user('问题'), assistant('回答', { requests: [dirty, good], request: good })],
  }

  const stats = sessionStats(session)
  // 脏值当 0，只剩那笔正常请求；不能把 9 位数累加进来
  assert.equal(stats.usage.input, 30)
  assert.equal(stats.usage.output, 20)
  assert.equal(stats.usage.total, 50)
  assert.ok(stats.usage.total < 1_000_000)
})

// 负数同样不该让总量变负（旧实现直接 Number 相加）。
test('negative token counts do not make the total negative', () => {
  const negative = { input: -500, output: -100, total: -600, provider: 'p', model: 'm' }
  const good = { input: 40, output: 10, total: 50, provider: 'p', model: 'm' }
  const session = {
    contextLimit: 128000,
    contextTokens: 40,
    messages: [user('问题'), assistant('回答', { requests: [negative, good], request: good })],
  }

  const stats = sessionStats(session)
  assert.equal(stats.usage.input, 40)
  assert.equal(stats.usage.output, 10)
  assert.equal(stats.usage.total, 50)
})
