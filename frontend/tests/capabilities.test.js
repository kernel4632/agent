/*
 * 能力管理前端逻辑：目录过滤、来源标签，以及请求体里的会话目录。
 * 只在 Node 里跑纯函数和 mock fetch，不启动浏览器。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Skills, externalRoots, sourceLabel } from "../src/features/skills.js"
import { Mcp, describeTarget } from "../src/features/mcp.js"
import { store } from '../src/store.js'

test('只列存在的外部技能目录，本应用自己的目录不重复展示', () => {
  const roots = [
    { id: 'own', kind: 'own', exists: true, path: 'D:/data/skills' },
    { id: 'claude', kind: 'app', exists: true, path: 'D:/home/.claude/skills' },
    { id: 'codex', kind: 'app', exists: false, path: 'D:/home/.codex/skills' },
    { id: 'extra-1', kind: 'source', exists: true, path: 'D:/work/skills' },
  ]
  assert.deepEqual(externalRoots(roots).map(root => root.id), ['claude', 'extra-1'])
  assert.deepEqual(externalRoots(null), [])
})

test('技能来源标签区分本应用和外部软件', () => {
  assert.equal(sourceLabel({ editable: true, app: 'Agent' }), '本应用')
  assert.equal(sourceLabel({ editable: false, app: 'Claude Code' }), 'Claude Code')
  assert.equal(sourceLabel({ editable: false }), '外部目录')
})

test('识别结果用命令或地址描述目标', () => {
  assert.equal(describeTarget({ command: 'npx', args: ['-y', 'server-github'] }), 'npx -y server-github')
  assert.equal(describeTarget({ url: 'https://mcp.example.test/mcp' }), 'https://mcp.example.test/mcp')
  assert.equal(describeTarget(null), '')
})

test('保存技能和导入 MCP 时带上当前会话目录', async t => {
  store.sessions['capability-session'] = { cwd: 'D:/work' }
  store.ui.activeSessionID = 'capability-session'
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : undefined })
    return Response.json({ name: 'review', enabled: true, imported: ['github'], skipped: [] })
  })
  try {
    await Skills.save({ name: 'review', description: '审查', body: '正文' })
    await Skills.toggle('review', false)
    await Skills.source('D:/other/skills', true)
    await Mcp.importServers(['cursor::github'])
    await Mcp.test('github')
  } finally {
    delete store.sessions['capability-session']
    store.ui.activeSessionID = ''
  }

  assert.deepEqual(calls.map(call => [call.method, call.url, call.body?.op]), [
    ['POST', '/api/admin', 'skill.save'],
    ['POST', '/api/admin', 'skill.toggle'],
    ['POST', '/api/admin', 'skill.source'],
    ['POST', '/api/admin', 'mcp.import'],
    ['POST', '/api/admin', 'mcp.test'],
  ])
  assert.deepEqual(calls[0].body, { op: 'skill.save', name: 'review', description: '审查', body: '正文', cwd: 'D:/work' })
  assert.deepEqual(calls[1].body, { op: 'skill.toggle', name: 'review', enabled: false, cwd: 'D:/work' })
  assert.deepEqual(calls[3].body, { op: 'mcp.import', ids: ['cursor::github'], cwd: 'D:/work' })
  assert.deepEqual(calls[4].body, { op: 'mcp.test', name: 'github' })
})
