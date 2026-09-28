import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readSSE } from '../src/utils/sse.js'
import { AgentAPI } from '../src/api.js'

test('SSE decodes split UTF-8, CRLF, heartbeats and events without an event name', async () => {
  const bytes = new TextEncoder().encode(': heartbeat\r\n\r\nid:12\r\ndata:{"type":"text-delta","text":"你好"}\r\n\r\ndata: {"type":"agent-finish"}\n\n')
  const stream = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close() } })
  const events = []
  await readSSE(new Response(stream), async event => { await Promise.resolve(); events.push(event) })
  assert.deepEqual(events, [{ type: 'text-delta', text: '你好', eventID: 12 }, { type: 'agent-finish', eventID: 0 }])
})

test('SSE accepts multiline JSON and reports HTTP failures', async () => {
  const events = []
  await readSSE(new Response('event: message\ndata: {"type":"text-delta",\ndata: "text":"ok"}\n\n'), event => events.push(event))
  assert.equal(events[0].text, 'ok')
  await assert.rejects(readSSE(new Response('Unavailable', { status: 503 }), () => {}), /503/)
})

test('API uses only routes and payloads implemented in server/server.js', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : undefined })
    return Response.json(url.endsWith('/create') ? { sessionId: 'session-test' } : { id: 'session-test', history: [], ok: true })
  })
  await AgentAPI.createSession('local', 'provider', 'model')
  await AgentAPI.renameSession('session-test', 'Title')
  await AgentAPI.sendMessage('session-test', 'Hello')
  await AgentAPI.stopSession('session-test')
  await AgentAPI.decideTool('session-test', 'call-1', 'allow-once')
  await AgentAPI.rollback('session-test', 'message-1')
  await AgentAPI.redo('session-test')
  await AgentAPI.subscribeSession('session-test', new AbortController().signal)
  await AgentAPI.getConfig()
  await AgentAPI.updateConfig({ providers: [] })
  assert.deepEqual(calls.map(call => [call.options.method || 'GET', call.url]), [
    ['POST', '/api/session/create'], ['GET', '/api/session/read/session-test'],
    ['PATCH', '/api/session/rename/session-test'], ['POST', '/api/agent/send/session-test'],
    ['POST', '/api/agent/stop/session-test'], ['POST', '/api/agent/decide/session-test'],
    ['POST', '/api/session/rollback/session-test'], ['POST', '/api/session/redo/session-test'],
    ['GET', '/api/sse/connect/session-test'], ['GET', '/api/config/read'], ['PATCH', '/api/config/set'],
  ])
  assert.deepEqual(calls[0].body, { title: '新对话', provider: 'provider', model: 'model' })
  assert.deepEqual(calls[3].body, { input: 'Hello' })
  assert.deepEqual(calls[5].body, { callId: 'call-1', decision: 'allow-once' })
  assert.equal(calls[8].options.headers['Last-Event-ID'], undefined)
  assert.equal(calls[8].url.includes('after='), false)
})

test('non-JSON HTTP error retains meaningful status', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('proxy unavailable', { status: 502 }))
  await assert.rejects(AgentAPI.getConfig(), error => error.status === 502 && error.message.includes('502'))
})
