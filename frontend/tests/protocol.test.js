/*
 * SSE 和接口测试：分块 UTF-8、CRLF、心跳、事件名和请求头都要按契约解析。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { patternOf, serverRoutes } from './server-routes.js'
import { readSSE } from '../src/utils/sse.js'
import { AgentAPI } from '../src/utils/api.js'

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

// 一帧坏掉只跳过它，不能让整条连接报错：事件流断一下不该让界面出错。
test('a malformed frame is skipped without breaking the stream', async () => {
  const events = []
  const body = 'data:{"type":"a"}\n\ndata: 这不是合法 JSON\n\ndata:{"type":"b"}\n\n'
  await readSSE(new Response(body), event => events.push(event))
  assert.deepEqual(events.map(event => event.type), ['a', 'b'])
})

test('所有前端请求的方法与路径都存在于 server.js 注册的路由', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : undefined })
    return Response.json(url.endsWith('/create') ? { sessionId: 'session-test' } : { id: 'session-test', history: [], ok: true })
  })

  await AgentAPI.createSession('D:/project', 'provider', 'model')
  await AgentAPI.renameSession('session-test', 'Title')
  await AgentAPI.sendMessage('session-test', 'Hello')
  await AgentAPI.stopSession('session-test')
  await AgentAPI.decideTool('session-test', 'call-1', 'allow')
  await AgentAPI.getSettings('session-test')
  await AgentAPI.saveSettings('session-test', { reasoning: 'high' })
  await AgentAPI.rollback('session-test', 'message-1')
  await AgentAPI.rollback('session-test', 'message-1', false)
  await AgentAPI.rollbackTool('session-test', 'call-9')
  await AgentAPI.redo('session-test')
  await AgentAPI.subscribeSession('session-test', new AbortController().signal)
  await AgentAPI.getConfig()
  await AgentAPI.updateConfig({ providers: [] })
  await AgentAPI.testProvider('provider', 'model')
  await AgentAPI.getMcpCatalog('D:/project')
  await AgentAPI.saveMcpServer('github', { command: 'npx', args: ['server-github'] })
  await AgentAPI.importMcpServers(['cursor::github'], 'D:/project')
  await AgentAPI.removeMcpServer('github')
  await AgentAPI.toggleMcpServer('github', false)
  await AgentAPI.testMcpServer('github')
  await AgentAPI.getSkills('D:/project')
  await AgentAPI.readSkill('review', 'D:/project')
  await AgentAPI.saveSkill({ name: 'review', description: '审查', body: '正文' })
  await AgentAPI.removeSkill({ name: 'review', cwd: 'D:/project' })
  await AgentAPI.toggleSkill({ name: 'review', enabled: false })
  await AgentAPI.toggleSkillSource({ path: 'D:/skills', enabled: true })
  await AgentAPI.getHealth()
  await AgentAPI.getTools()
  await AgentAPI.getToolKinds()
  await AgentAPI.getConfigMeta()
  await AgentAPI.getSessionList('名称')
  await AgentAPI.getSession('session-test')
  await AgentAPI.setSessionModel('session-test', 'provider', 'model')
  await AgentAPI.forkSession('session-test', { messageId: 'message-1' })
  await AgentAPI.resumeSession('session-test')
  await AgentAPI.removeSession('session-test')

  assert.deepEqual(calls.map(call => [call.options.method || 'GET', call.url]), [
    ['POST', '/api/session/create'], ['GET', '/api/session/read/session-test'],
    ['PATCH', '/api/session/rename/session-test'], ['POST', '/api/agent/send/session-test'],
    ['POST', '/api/agent/stop/session-test'], ['POST', '/api/agent/decide/session-test'],
    ['GET', '/api/session/settings/session-test'],
    ['PATCH', '/api/session/settings/session-test'],
    ['POST', '/api/session/rollback/session-test'], ['POST', '/api/session/rollback/session-test'],
    ['POST', '/api/session/rollback/session-test'],
    ['POST', '/api/session/rollback/redo/session-test'],
    ['GET', '/api/sse/connect/session-test'],
    ...Array.from({ length: 15 }, () => ['POST', '/api/admin']),
    ['GET', '/api/health'],
    ['POST', '/api/admin'], ['POST', '/api/admin'], ['POST', '/api/admin'],
    ['GET', '/api/session/list?search=%E5%90%8D%E7%A7%B0'],
    ['GET', '/api/session/read/session-test'],
    ['PATCH', '/api/session/settings/session-test'],
    ['POST', '/api/session/fork/session-test'],
    ['POST', '/api/agent/resume/session-test'],
    ['DELETE', '/api/session/remove/session-test'],
  ])
  assert.deepEqual(calls[0].body, { title: '新对话', provider: 'provider', model: 'model', cwd: 'D:/project' })
  assert.deepEqual(calls[3].body, { input: 'Hello' })
  // 后端 /agent/decide 读的是 toolCallId；决定只有 allow / deny。
  assert.deepEqual(calls[5].body, { toolCallId: 'call-1', decision: 'allow' })
  // 设置只发点名的那几项，后端只改这几项。
  assert.deepEqual(calls[7].body, { reasoning: 'high' })
  // files 决定回退要不要连文件一起退：不传是 true，传 false 表示只退对话。
  assert.deepEqual(calls[8].body, { messageId: 'message-1', files: true })
  assert.deepEqual(calls[9].body, { messageId: 'message-1', files: false })
  // 工具级回退按 toolCallId 定位，和消息级共用一条路由。
  assert.deepEqual(calls[10].body, { toolCallId: 'call-9', files: true })
  assert.deepEqual(calls[11].body, { files: true })
  assert.equal(calls[12].options.headers['Last-Event-ID'], undefined)
  // 管理面的每条请求都带 op，路由只有 /api/admin 一条。
  for (const call of calls.filter(item => item.url === '/api/admin')) assert.ok(call.body?.op, '管理请求缺少 op')

  // 前端发出的每条请求，必须在 server.js 里真实注册过。
  for (const call of calls) {
    const path = new URL(call.url, 'http://test').pathname.replace(/^\/api/, '')
    const method = (call.options.method || 'GET').toUpperCase()
    const exists = serverRoutes.some(route => route.method === method && patternOf(route.path).test(path))
    assert.ok(exists, `接口不存在：${method} ${path}`)
  }
})

test('non-JSON HTTP error retains meaningful status', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('proxy unavailable', { status: 502 }))
  await assert.rejects(AgentAPI.getConfig(), error => error.status === 502 && error.message.includes('502'))
})
