import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupMessageTurns } from '../src/session/turns.js'

const user = id => ({ id, role: 'user', content: id })
const assistant = id => ({ id, role: 'assistant', content: id })

test('a user message and the assistant replies after it form two turns', () => {
  // 自动接续会产生多条 assistant 消息，它们属于同一轮，只留一次头像和名字。
  const turns = groupMessageTurns([user('u1'), assistant('a1'), assistant('a2')])

  assert.equal(turns.length, 2)
  assert.equal(turns[0].role, 'user')
  assert.deepEqual(turns[0].messages.map(message => message.id), ['u1'])
  assert.equal(turns[1].role, 'assistant')
  // 轮次的 id 取这一轮第一条助手消息的 id。
  assert.equal(turns[1].id, 'a1')
  assert.deepEqual(turns[1].messages.map(message => message.id), ['a1', 'a2'])
})

test('each user message starts a new turn', () => {
  const turns = groupMessageTurns([user('u1'), assistant('a1'), user('u2'), assistant('a2')])

  assert.equal(turns.length, 4)
  assert.deepEqual(turns.map(turn => [turn.role, turn.id]), [
    ['user', 'u1'], ['assistant', 'a1'], ['user', 'u2'], ['assistant', 'a2'],
  ])
  assert.deepEqual(turns.map(turn => turn.messages.length), [1, 1, 1, 1])
})

test('consecutive user messages are not merged', () => {
  const turns = groupMessageTurns([user('u1'), user('u2'), assistant('a1')])

  assert.equal(turns.length, 3)
  assert.deepEqual(turns.map(turn => turn.id), ['u1', 'u2', 'a1'])
  assert.deepEqual(turns[1].messages.map(message => message.id), ['u2'])
})

test('empty history produces no turns', () => {
  assert.deepEqual(groupMessageTurns([]), [])
  assert.deepEqual(groupMessageTurns(), [])
})
