/*
 * 能力管理前端逻辑：MCP 目标描述，以及请求体里的会话目录。
 * 技能相关的前端逻辑已经搬进 extensions/skill/，不在框架里测。
 * 只在 Node 里跑纯函数和 mock fetch，不启动浏览器。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Mcp, describeTarget } from "../src/features/mcp.js"
import { store } from '../src/store.js'

test('识别结果用命令或地址描述目标', () => {
  assert.equal(describeTarget({ command: 'npx', args: ['-y', 'server-github'] }), 'npx -y server-github')
  assert.equal(describeTarget({ url: 'https://mcp.example.test/mcp' }), 'https://mcp.example.test/mcp')
  assert.equal(describeTarget(null), '')
})

test('导入 MCP 时带上当前会话目录', async t => {
  store.sessions['capability-session'] = { cwd: 'D:/work' }
  store.ui.activeSessionID = 'capability-session'
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : undefined })
    return Response.json({ imported: ['github'], skipped: [] })
  })
  try {
    await Mcp.importServers(['cursor::github'])
    await Mcp.test('github')
  } finally {
    delete store.sessions['capability-session']
    store.ui.activeSessionID = ''
  }

  assert.deepEqual(calls.map(call => [call.method, call.url, call.body?.op]), [
    ['POST', '/api/admin', 'mcp.import'],
    ['POST', '/api/admin', 'mcp.test'],
  ])
  assert.deepEqual(calls[0].body, { op: 'mcp.import', ids: ['cursor::github'], cwd: 'D:/work' })
  assert.deepEqual(calls[1].body, { op: 'mcp.test', name: 'github' })
})
