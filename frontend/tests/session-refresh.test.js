/* 会话设置和历史刷新并发：迟到响应不能把用户刚选的值写回旧对象或旧快照。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { store } from '../src/store.js'
import { AgentAPI } from '../src/utils/api.js'
import { Session } from "../src/features/session.js"
import { History } from "../src/features/session.js"
import { Chat } from '../src/commands/chat.js'

const snapshot = () => ({ id: 'race', provider: 'test', model: 'm', history: [], settings: { reasoning: 'auto' } })

test('历史读取期间收到的重试事件不会被旧快照清掉', async () => {
  const original = AgentAPI.getSession
  let complete
  AgentAPI.getSession = () => new Promise(resolve => { complete = resolve })
  store.sessions.race = History.normalize({ ...snapshot(), running: true })
  try {
    const reading = History.refresh('race')
    await Chat.receive('race', { type: 'retry', attempt: 1, delay: 5000 })
    complete({ ...snapshot(), running: true })
    await reading
    assert.equal(store.sessions.race.status, 'running')
    assert.match(store.sessions.race.messages.at(-1).requests.at(-1).retry, /5s/)
  } finally { AgentAPI.getSession = original; delete store.sessions.race }
})

test('保存完成时更新当前会话，即使刷新期间会话对象被替换', async () => {
  const original = AgentAPI.saveSettings
  let complete
  AgentAPI.saveSettings = () => new Promise(resolve => { complete = resolve })
  store.sessions.race = History.normalize(snapshot())
  try {
    const saving = Session.saveSettings('race', { reasoning: 'high' })
    store.sessions.race = History.normalize(snapshot()) // 模拟保存途中收到历史刷新
    complete({ reasoning: 'high' })
    await saving
    assert.equal(store.sessions.race.settings.reasoning, 'high')
  } finally { AgentAPI.saveSettings = original; delete store.sessions.race }
})

test('再次打开已连接运行中的会话保留尚未落盘的重试状态', async () => {
  const original = AgentAPI.getSession
  AgentAPI.getSession = async () => ({ ...snapshot(), running: true })
  store.sessions.race = History.normalize({ ...snapshot(), running: true })
  store.sessions.race.connection = 'connected'
  try {
    await Chat.receive('race', { type: 'retry', attempt: 2, delay: 1000 })
    await History.refresh('race')
    assert.match(store.sessions.race.messages.at(-1).requests.at(-1).retry, /第 2 次/)
  } finally { AgentAPI.getSession = original; delete store.sessions.race }
})

test('读取开始后发生的设置修改不会被迟到的历史快照覆盖', async () => {
  const original = AgentAPI.getSession
  let complete
  AgentAPI.getSession = () => new Promise(resolve => { complete = resolve })
  store.sessions.race = History.normalize(snapshot())
  try {
    const reading = History.refresh('race')
    store.sessions.race.settings = { reasoning: 'high' }
    complete(snapshot()) // 旧快照仍然是 auto
    await reading
    assert.equal(store.sessions.race.settings.reasoning, 'high')
  } finally { AgentAPI.getSession = original; delete store.sessions.race }
})
