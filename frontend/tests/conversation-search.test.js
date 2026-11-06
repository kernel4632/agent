import { test } from 'node:test'
import assert from 'node:assert/strict'
import { searchConversation } from '../src/features/conversation-search.js'

const messages = [
  { id: 'u1', role: 'user', content: '帮我看看这段代码' },
  { id: 'a1', role: 'assistant', content: '可以，先检查入口文件。' },
  { id: 'u2', role: 'user', content: '再找一下 TOKEN 的位置' },
  { id: 'a2', role: 'assistant', content: 'Token 在配置里。' },
]

test('conversation search matches visible messages case-insensitively', () => {
  const results = searchConversation(messages, 'token')
  assert.deepEqual(results.map(result => result.id), ['u2', 'a2'])
  assert.ok(results[0].markdown.includes('TOKEN'))
  assert.ok(results[1].markdown.includes('Token'))
})

test('conversation search keeps markdown source for rendering', () => {
  const [result] = searchConversation([{ id: 'a3', role: 'assistant', content: '**重点**内容和 `code`' }], '重点')
  assert.equal(result.markdown, '**重点**内容和 `code`')
})

test('conversation search snippets stay bounded around the match', () => {
  const long = `${'前置内容'.repeat(120)}目标文本${'后置内容'.repeat(120)}`
  const [result] = searchConversation([{ id: 'a1', role: 'assistant', content: long }], '目标文本')
  assert.ok(result.markdown.includes('目标文本'))
  assert.ok(result.markdown.startsWith('…'))
  assert.ok(result.markdown.length < 520)
})

test('conversation search skips compact markers and stops at the limit', () => {
  const many = Array.from({ length: 8 }, (_, index) => ({ id: `m${index}`, role: 'user', content: `关键词 ${index}` }))
  many.splice(2, 0, { id: 'compact', role: 'user', compact: true, content: '关键词不应出现' })
  const results = searchConversation(many, '关键词', 3)
  assert.equal(results.length, 3)
  assert.ok(!results.some(result => result.id === 'compact'))
})
