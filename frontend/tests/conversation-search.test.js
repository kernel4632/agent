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
  assert.equal(results[0].match, 'TOKEN')
  assert.equal(results[1].match, 'Token')
  const markdown = searchConversation([{ id: 'a3', role: 'assistant', content: '**重点**内容' }], '重点')[0]
  assert.equal(`${markdown.before}${markdown.match}${markdown.after}`, '重点内容')
})

test('conversation search snippets contain the match and stay bounded', () => {
  const long = `${'前置内容'.repeat(30)}目标文本${'后置内容'.repeat(50)}`
  const [result] = searchConversation([{ id: 'a1', role: 'assistant', content: long }], '目标文本')
  assert.equal(result.match, '目标文本')
  assert.ok(result.before.startsWith('…'))
  assert.ok(result.after.endsWith('…'))
  assert.ok(result.before.length < 50)
  assert.ok(result.after.length < 110)
})

test('conversation search skips compact markers and stops at the limit', () => {
  const many = Array.from({ length: 8 }, (_, index) => ({ id: `m${index}`, role: 'user', content: `关键词 ${index}` }))
  many.splice(2, 0, { id: 'compact', role: 'user', compact: true, content: '关键词不应出现' })
  const results = searchConversation(many, '关键词', 3)
  assert.equal(results.length, 3)
  assert.ok(!results.some(result => result.id === 'compact'))
})
