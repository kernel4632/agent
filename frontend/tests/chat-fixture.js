/*
聊天页测试夹具：拦截 /api 契约，提供可读写的内存会话；SSE 使用本机持续连接。
界面测试共用这一份，页面关闭时释放测试端口和连接。
调用示例：
  const mock = await backend(page)
  await navigate(page, '新建对话')
  await mock.emit('session-1', [{ type: 'agent-finish' }])
*/
import { expect } from '@playwright/test'
import { createServer } from 'node:http'
import { patternOf, serverRoutes } from './server-routes.js'

// 模拟接口按 server.js 的真实注册来：已经删掉的路径不能继续假装返回成功。
const routes = serverRoutes.map(route => ({ method: route.method, pattern: patternOf(route.path) }))

// 管理总线的 op → 旧分支：测试沿用旧的路径写法，实现不用重写。
const ADMIN_ROUTES = {
  'config.read': ['GET', '/config/read'],
  'config.set': ['PATCH', '/config/set'],
  'config.meta': ['GET', '/config/meta'],
  'config.export': ['GET', '/config/export'],
  'config.import': ['POST', '/config/import'],
  'config.backup.list': ['GET', '/config/backups'],
  'config.backup.read': ['GET', '/config/backups'],
  'config.restore': ['POST', '/config/restore'],
  'config.test': ['POST', '/config/test'],
  'mcp.list': ['GET', '/mcp/list'],
  'mcp.save': ['POST', '/mcp/save'],
  'mcp.import': ['POST', '/mcp/import'],
  'mcp.remove': ['POST', '/mcp/remove'],
  'mcp.toggle': ['PATCH', '/mcp/toggle'],
  'mcp.test': ['POST', '/mcp/test'],
  'skill.list': ['GET', '/skill/list'],
  'skill.read': ['GET', '/skill/read'],
  'skill.save': ['POST', '/skill/save'],
  'skill.remove': ['POST', '/skill/remove'],
  'skill.toggle': ['PATCH', '/skill/toggle'],
  'skill.source': ['PATCH', '/skill/source'],
  'storage.status': ['GET', '/storage/sessions'],
  'storage.set': ['PUT', '/storage/sessions'],
  'storage.cancel': ['DELETE', '/storage/sessions'],
  'session.groups.set': ['PUT', '/session/groups'],
  'model.family': ['GET', '/model/family'],
  'model.icon': ['GET', '/model/icon'],
  'fs.entries': ['GET', '/filesystem/entries'],
  'tool.list': ['GET', '/tool/list'],
  'tool.kinds': ['GET', '/tool/kinds'],
}

export async function backend(page, { configured = true } = {}) {
  let config = {
    providers: configured ? [{ name: 'Test Provider', enabled: true, protocol: 'openai-compatible', stream: true, baseURL: 'https://model.example.test/v1', apiKey: 'test-only-key', models: [{ id: 'test-model', name: 'test-model', context: 64000, capabilities: ['text', 'tools'] }], headers: { 'x-preserve': 'yes' }, body: { temperature: 0.25 } }] : [],
    models: { chat: { provider: configured ? 'Test Provider' : '', model: configured ? 'test-model' : '' }, compact: { provider: '', model: '' }, title: { provider: '', model: '' }, task: { provider: '', model: '' } },
    prompt: { system: 'Be helpful.', seeded: true }, compact: { threshold: 0.8 },
    // 和 server/features/config.js 的 normalize 一样：压缩后保留多少原文。
    contextKeep: { firstTurns: 3, recentTurns: 3, firstShare: 0.2, recentShare: 0.3 },
    permission: { '*': 'ask', execute_command: { '*': 'ask' } }, mcp: { sample: { transport: 'sse', url: 'https://mcp.example.test' } },
  }
  let backups = []
  let sessionGroups = []
  let healthState = { ok: true, version: 'test', targetVersion: 'test', restartRequired: false }
  const rememberConfig = () => {
    const serialized = JSON.stringify(config)
    backups.unshift({
      id: `config-mock-${Date.now()}-${backups.length}`,
      createdAt: Date.now(),
      size: serialized.length,
      providers: config.providers.length,
      models: config.providers.reduce((sum, provider) => sum + (provider.models?.length || 0), 0),
      config: structuredClone(config),
    })
    backups = backups.slice(0, 20)
  }
  rememberConfig()
  // 技能页和 MCP 识别使用同一份内存夹具；界面测试只验证读写路径，不碰真实磁盘。
  const skills = {
    skills: [
      { name: 'review', description: '审查改动时用这个', body: '第一步：读 diff。', path: 'D:/mock/.agents/skills/review/SKILL.md', directory: 'D:/mock/.agents/skills/review', source: 'own', sourceLabel: '本应用', app: 'Agent', scope: 'global', kind: 'own', editable: true, enabled: true },
    ],
    roots: [
      { id: 'own', label: '本应用', app: 'Agent', path: 'D:/mock/.agents/skills', scope: 'global', kind: 'own', editable: true, enabled: true, exists: true, skillCount: 1, skills: ['review'] },
      { id: 'claude', label: 'Claude Code', app: 'Claude Code', path: 'D:/mock/.claude/skills', scope: 'global', kind: 'app', editable: false, enabled: false, exists: true, skillCount: 1, skills: ['lint'] },
    ],
    state: { sources: [], disabled: [] },
  }
  const detected = {
    sources: [
      { id: 'cursor', app: 'Cursor', path: 'D:/mock/.cursor/mcp.json', servers: 1 },
      { id: 'claude-code', app: 'Claude Code', path: 'D:/mock/.claude.json', servers: 1 },
    ],
    servers: [{
      id: 'cursor::github', name: 'github', app: 'Cursor', source: 'cursor', path: 'D:/mock/.cursor/mcp.json',
      definition: { command: 'npx', args: ['-y', 'server-github'], env: {} }, envKeys: ['GITHUB_TOKEN'], headerKeys: [], configured: false,
    }, {
      id: 'claude-code::github', name: 'github', app: 'Claude Code', source: 'claude-code', path: 'D:/mock/.claude.json',
      definition: { command: 'npx', args: ['-y', 'server-github'], env: {} }, envKeys: ['GITHUB_TOKEN'], headerKeys: [], configured: false,
    }, {
      id: 'opencode::github', name: 'github', app: 'opencode', source: 'opencode', path: 'D:/mock/.config/opencode/opencode.json',
      definition: { command: 'bunx', args: ['server-github'], env: {} }, envKeys: ['GITHUB_TOKEN'], headerKeys: [], configured: false,
    }],
  }
  const storageState = {
    path: 'C:/mock/.agent/sessions',
    defaultPath: 'C:/mock/.agent/sessions',
    envOverride: false,
    pending: null,
    error: '',
    lastMove: null,
  }
  const sessions = new Map()
  const calls = []
  const connections = new Map()
  const queued = new Map()
  const errors = []
  const CONTINUE_TEXT = '继续上次未完成的任务，从现有进度接着做，不要重复已经完成的内容；完成后调用结束工具。' // 真实后端隐藏的内部提示
  page.on('pageerror', error => errors.push(error.message))

  // route.fulfill 会结束响应，不能模拟持续 SSE：它曾触发假重连，刷新掉未保存的回复。
  // 仅事件流走这个临时端口，其余 HTTP 请求仍由下面的路由夹具处理。
  const eventServer = createServer((request, response) => {
    const id = new URL(request.url, 'http://localhost').pathname.split('/').at(-1)
    connections.get(id)?.end()
    connections.set(id, response)
    response.on('close', () => {
      if (connections.get(id) === response) connections.delete(id)
    })
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'access-control-allow-origin': request.headers.origin || new URL(page.url()).origin,
      'access-control-allow-credentials': 'true',
    })
    response.write(queued.get(id) || ': connected\n\n')
    queued.delete(id)
  })
  await new Promise((resolve, reject) => {
    eventServer.once('error', reject)
    eventServer.listen(0, '127.0.0.1', resolve)
  })
  page.once('close', () => {
    eventServer.close()
    eventServer.closeAllConnections()
  })
  const eventsURL = `http://127.0.0.1:${eventServer.address().port}`

  // 真实后端会把进行中的工具调用写进历史；mock 也照做，
  // 否则 SSE 断开重连后的刷新会把审批卡片冲掉，测试就会看到假失败。
  function persistTool(id, event) {
    if (!['tool-call', 'permission', 'tool-result'].includes(event.type)) return
    const session = sessions.get(id)                                                  // 找到这次事件对应的会话
    const callId = event.toolCallId || event.callID                                    // 两种字段名都认
    if (!session || !callId) return
    // 等待审批的工具要写进 pending；刷新历史时界面靠它恢复“允许/拒绝”按钮。
    if (event.type === 'permission') {
      if (!session.pending.some(item => (item.callID || item.toolCallId) === callId)) {
        session.pending.push({ callID: callId, tool: event.tool, input: event.input })
      }
    }
    if (event.type === 'tool-result') {
      session.pending = session.pending.filter(item => (item.callID || item.toolCallId) !== callId)
    }
    let message = session.history.findLast(item => item.role === 'assistant' && Array.isArray(item.content) && item.content.some(part => part.type === 'tool-invocation'))
    if (!message) {                                                                    // 还没有带工具调用的助手消息
      message = { messageId: 'assistant-live', role: 'assistant', content: [] }         // 就补一条，刷新时能还原审批卡片
      session.history.push(message)
    }
    let part = message.content.find(item => item.type === 'tool-invocation' && item.toolCallId === callId)
    if (!part) {                                                                       // 同一个工具调用只存一份
      part = { type: 'tool-invocation', toolCallId: callId, toolName: event.toolName || event.tool, state: 'call', args: event.input || {} }
      message.content.push(part)
    }
    if (event.type === 'tool-result') {
      part.state = 'result'                                                            // 有结果后刷新应显示完成，而不是仍在执行
      part.result = { output: event.output }
    }
  }
  async function emit(id, events) {
    for (const event of events) persistTool(id, event)
    const body = events.map((event, index) => `id: ${event.type === 'agent-finish' ? 1 : index + 1}\ndata: ${JSON.stringify(event)}\n\n`).join('')
    const connection = connections.get(id)
    if (connection && !connection.destroyed && !connection.writableEnded) connection.write(body)
    else queued.set(id, (queued.get(id) || '') + body) // 建立连接前的多批事件按顺序保留
  }
  await page.route('**/api/**', async route => {
    const request = route.request()
    let path = new URL(request.url()).pathname.replace('/api', '')
    let method = request.method()
    let body = request.postData() ? request.postDataJSON() : undefined
    calls.push({ path, method, body })
    if (!routes.some(route => route.method === method && route.pattern.test(path))) {
      errors.push(`不存在的接口：${method} ${path}`)
      return route.fulfill({ status: 404, json: { error: 'NOT_FOUND' } })
    }
    // 管理总线：把 { op, ...参数 } 翻回具体分支，下面的实现一行不用改。
    if (path === '/admin' && body?.op) {
      const [aliasMethod, aliasPath] = ADMIN_ROUTES[body?.op] || []
      if (!aliasMethod) {
        errors.push(`未知的管理 op：${body?.op}`)
        return route.fulfill({ status: 400, json: { error: `unknown op: ${body?.op}` } })
      }
      const { op, ...args } = body
      path = op === 'config.backup.read' ? `/config/backups/${encodeURIComponent(args.id)}` : aliasPath
      method = aliasMethod
      // config.set 的旧分支直接吃整份配置，这里把 op 拆掉后的 config 展开。
      body = op === 'config.set' ? (args.config || {}) : args
    }
    const json = data => route.fulfill({ status: 200, json: data })
    // GET /admin 只有模型图标（<img src> 用），直接给一个占位 SVG。
    if (path === '/admin' && method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' })
    }
    if (path === '/filesystem/entries') {
      const target = body?.path || new URL(request.url()).searchParams.get('path') || 'C:/mock'
      const mode = body?.mode || new URL(request.url()).searchParams.get('mode') || 'directory'
      const directories = {
        'C:/mock/.agent/sessions': { current: 'C:/mock', parent: null, entries: [{ name: 'D:', path: 'D:/', type: 'directory' }] },
        'C:/mock': { current: 'C:/mock', parent: null, entries: [{ name: 'D:', path: 'D:/', type: 'directory' }] },
        'D:/': { current: 'D:/', parent: 'C:/', entries: [{ name: 'AgentSessions', path: 'D:/AgentSessions', type: 'directory' }, { name: 'Tools', path: 'D:/Tools', type: 'directory' }] },
        'D:/AgentSessions': { current: 'D:/AgentSessions', parent: 'D:/', entries: [] },
        'D:/Tools': { current: 'D:/Tools', parent: 'D:/', entries: [{ name: 'server.exe', path: 'D:/Tools/server.exe', type: 'file' }] },
      }
      const data = directories[target] || directories['C:/mock']
      return json({ ...data, home: 'C:/mock', roots: ['C:/', 'D:/'], truncated: false, mode })
    }
    if (path === '/storage/sessions') {
      if (method === 'GET') return json(storageState)
      if (method === 'PUT') {
        storageState.pending = { from: storageState.path, path: body.path }
        return json({ path: storageState.path, pending: storageState.pending })
      }
      if (method === 'DELETE') {
        storageState.pending = null
        return json({ ok: true })
      }
    }
    if (path === '/config/read') return json(config)
    if (path === '/config/meta') return json({
      models: [
        { task: 'chat', label: '对话', hint: '会话默认使用的模型' },
        { task: 'compact', label: '压缩上下文', hint: '把长对话总结成一段' },
        { task: 'title', label: '生成标题', hint: '给会话起一个短标题' },
        { task: 'task', label: '子任务', hint: '子 agent 干活时用的模型' },
      ],
    })
    if (path === '/config/backups') return json(backups.map(({ config: _config, ...meta }) => meta))
    if (path.startsWith('/config/backups/')) {
      const id = decodeURIComponent(path.slice('/config/backups/'.length))
      const backup = backups.find(item => item.id === id)
      return backup ? json(backup) : route.fulfill({ status: 404, json: { error: 'not found' } })
    }
    if (path === '/config/restore') {
      const backup = backups.find(item => item.id === body?.id)
      if (!backup) return route.fulfill({ status: 404, json: { error: 'not found' } })
      rememberConfig()
      config = structuredClone(backup.config)
      return json({ ok: true, id: backup.id })
    }
    if (path === '/config/import') {
      rememberConfig()
      config = structuredClone(body.config)
      return json({ ok: true })
    }
    if (path === '/config/export') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(config) })
    }
    if (path === '/config/set') {
      expect(Object.keys(body).sort()).toEqual(Object.keys(config).sort())
      expect(body.providers.every(provider => provider.models.every(model => typeof model.id === 'string'))).toBe(true)
      rememberConfig()
      config = body
      return json(config)
    }
    if (path === '/config/test') return json({ ok: true, provider: body?.provider, model: body?.model, text: 'ok' })
    if (path === '/mcp/list') return json({
      servers: Object.entries(config.mcp || {}).map(([name, definition]) => ({ name, enabled: definition.enabled !== false, definition })),
      detected,
    })
    if (path === '/mcp/import') {
      const imported = []
      for (const id of body.ids || []) {
        const server = detected.servers.find(item => item.id === id)
        if (!server || config.mcp[server.name]) continue
        config.mcp[server.name] = { ...server.definition, enabled: true }
        server.configured = true
        imported.push(server.name)
      }
      return json({ imported, skipped: [] })
    }
    if (path === '/mcp/test') return json({ ok: true, name: body.name, tools: ['echo'] })
    if (path === '/skill/list') return json(skills)
    if (path === '/skill/read') {
      const name = body?.name || new URL(request.url()).searchParams.get('name')
      const skill = skills.skills.find(item => item.name === name)
      return skill ? json(skill) : route.fulfill({ status: 404, json: { error: 'Skill not found' } })
    }
    if (path === '/skill/save') {
      const existing = skills.skills.find(item => item.name === body.name)
      const item = {
        ...(existing || {}),
        name: body.name,
        description: body.description,
        body: body.body || '',
        path: `D:/mock/.agents/skills/${body.name}/SKILL.md`,
        directory: `D:/mock/.agents/skills/${body.name}`,
        source: 'own',
        sourceLabel: '本应用',
        app: 'Agent',
        scope: body.scope || 'global',
        kind: 'own',
        editable: true,
        enabled: true,
      }
      if (existing) Object.assign(existing, item)
      else skills.skills.push(item)
      return json(item)
    }
    if (path === '/skill/remove') {
      skills.skills = skills.skills.filter(item => item.name !== body.name)
      return json({ ok: true, name: body.name })
    }
    if (path === '/skill/toggle') {
      const skill = skills.skills.find(item => item.name === body.name)
      if (skill) skill.enabled = body.enabled
      return json({ name: body.name, enabled: body.enabled })
    }
    if (path === '/skill/source') {
      const root = skills.roots.find(item => item.path === body.path)
      if (root) root.enabled = body.enabled
      return json({ path: body.path, enabled: body.enabled })
    }
    if (path === '/session/list') return json({ sessions: [...sessions.values()], groups: [] })
    if (path === '/session/groups') {
      if (method === 'GET') return json({ groups: sessionGroups })
      if (method === 'PUT') {
        sessionGroups = body.groups
        return json({ groups: sessionGroups })
      }
    }
    if (path === '/health') return json({ ...healthState, sessions: sessions.size, running: 0 })
    if (path === '/tool/kinds') return json([
      { kind: 'read', label: '读取', hint: '读文件、搜索不用再问' },
      { kind: 'write', label: '写入', hint: '改文件、打补丁不用问' },
      { kind: 'command', label: '执行命令', hint: '跑命令不用再问' },
      { kind: 'mcp', label: '使用 MCP', hint: 'MCP 工具不用再问' },
      { kind: 'subtask', label: '子任务', hint: '开子任务不用再问' },
    ])
    if (path === '/tool/list') return json([
      {
        name: 'read_file', kind: 'read', kindLabel: '读取', kindHint: '读文件、搜索不用再问', permission: 'ask', configurable: true,
        ui: { view: 'file-read', icon: 'document', title: '读取文件', summary: '{path}' },
      },
      {
        name: 'write_file', kind: 'write', kindLabel: '写入', kindHint: '改文件、打补丁不用问', permission: 'ask', configurable: true,
        ui: { view: 'file-write', icon: 'edit', title: '写入文件', summary: '{path}' },
      },
      {
        name: 'execute_command', kind: 'command', kindLabel: '执行命令', kindHint: '跑命令不用再问', permission: 'ask', configurable: true,
        ui: { view: 'command', icon: 'code', title: '执行命令', summary: '{command}' },
      },
      {
        name: 'sample_tool', kind: 'mcp', kindLabel: '使用 MCP', kindHint: 'MCP 工具不用再问', permission: 'ask', configurable: true,
        ui: { view: 'generic', icon: 'globe', title: 'sample_tool', summary: '{query}' },
      },
      {
        name: 'new_task', kind: 'subtask', kindLabel: '子任务', kindHint: '开子任务不用再问', permission: 'ask', configurable: true,
        ui: { view: 'subtask', icon: 'branch', title: '创建子任务', summary: '{description}' },
      },
      {
        name: 'update_todo_list', kind: 'never', permission: 'ask', configurable: false,
        ui: { view: 'todo', icon: 'check', title: '任务清单', summary: '当前进度' },
      },
      {
        name: 'attempt_completion', kind: 'never', permission: 'never', configurable: false,
        ui: { view: 'completion', icon: 'check', title: '完成任务', summary: '最终结果' },
      },
      {
        name: 'ask_followup_question', kind: 'never', permission: 'never', configurable: false,
        ui: { view: 'question', icon: 'info', title: '询问用户', summary: '{question}' },
      },
    ])
    if (path === '/session/create') {
      const id = `session-${sessions.size + 1}`
      sessions.set(id, {
        id,
        title: body.title,
        cwd: body.cwd || 'C:/mock/agent-session-test',
    temporary: !body.cwd,
        provider: body.provider,
        model: body.model,
        history: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        settings: {
          reasoning: 'auto',
        },
        todos: [],
        running: false,
        pending: [],
        undoable: 0,
      })
      return json({ sessionId: id })
    }
    // /session/read/:id?segment=<segmentId> 读某个封存段，?segmented=true 只返回当前段
    if (path.startsWith('/session/read/')) {
      const id = path.split('/').at(-1)
      const session = sessions.get(id)
      if (!session) return json({ error: 'Session not found' }, 404)
      const url = new URL(request.url())
      const segmentId = url.searchParams.get('segment')
      if (segmentId) {
        return json({ id, segment: segmentId, messages: session.segmentData?.[segmentId] || [] })
      }
      const segmented = url.searchParams.get('segmented') === 'true'
      if (segmented && session.historyManifest) {
        const visible = session.history.filter(item => !item.internal)
        const currentStart = session.historyManifest.current?.startIndex ?? 0
        const current = visible.slice(currentStart)
        const total = session.historyManifest && Number.isInteger(session.historyTotal) ? session.historyTotal : visible.length
        return json({ ...session, history: current, historyTotal: total })
      }
      // 走下面的正常 read 逻辑（全量）
    }
    const id = path.split('/').at(-1)
    const session = sessions.get(id)
    if (path.startsWith('/session/model/')) {
      session.provider = body.provider
      session.model = body.model
      return json(session)
    }
    if (path.startsWith('/session/fork/')) {
      const newId = `session-${sessions.size + 1}`
      sessions.set(newId, {
        ...session,
        id: newId,
        title: (body && body.title) || `${session.title}（分支）`,
        history: structuredClone(session.history),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      return json({ sessionId: newId })
    }
    if (path.startsWith('/sse/connect/')) {
      return route.continue({ url: `${eventsURL}/${id}` })
    }
    if (!session) return route.fulfill({ status: 404, json: { error: 'Session not found' } })
    if (path.startsWith('/session/cwd/')) {
      if (method === 'PATCH') {
        session.cwd = body.cwd
        session.temporary = false
      }
      return json({ id: session.id, cwd: session.cwd, temporary: false })
    }
    if (path.startsWith('/session/settings/')) {
      if (method === 'PATCH') {
        expect(Object.keys(body)).toEqual(['reasoning'])
        session.settings = { ...session.settings, ...body }
      }
      return json(session.settings)
    }
    if (path.startsWith('/session/outline/')) {
      const turns = []
      let current = null
      session.history.forEach((message, index) => {
        if (message.compact) return
        const text = Array.isArray(message.content)
          ? message.content.filter(part => part.type === 'text').map(part => part.text || '').join(' ')
          : String(message.content || '')
        if (message.role === 'user') {
          current = { id: message.messageId, index, role: 'user', prompt: text.slice(0, 120), response: '', length: text.length }
          turns.push(current)
        } else if (message.role === 'assistant') {
          if (current && !current.response) {
            current.response = text.slice(0, 240)
            current.length = (current.length || 0) + text.length
          } else if (!current) {
            current = { id: message.messageId, index, role: 'assistant', prompt: '', response: text.slice(0, 240), length: text.length }
            turns.push(current)
          }
        }
      })
      return json({ turns, totalMessages: session.history.length })
    }
    if (path.startsWith('/session/open/')) {
      const visible = session.history.filter(item => !item.internal)
      const total = session.historyManifest && Number.isInteger(session.historyTotal) ? session.historyTotal : visible.length
      const payload = { type: 'session', session: { ...session, history: visible, historyTotal: total } }
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream; charset=utf-8' },
        body: `data: ${JSON.stringify(payload)}\n\n`,
      })
    }
    // 真实 Server 的 read 会过滤 internal 消息；mock 也照做，才能测到“继续提示不出现”。
    if (path.startsWith('/session/read/')) {
      const visible = session.history.filter(item => !item.internal)
      const total = session.historyManifest && Number.isInteger(session.historyTotal) ? session.historyTotal : visible.length
      const after = new URL(request.url()).searchParams.get('after')
      if (after) {
        const index = visible.findIndex(item => item.messageId === after || item.id === after)
        return json({ ...session, delta: index < 0 ? [] : visible.slice(index + 1), historyTotal: total })
      }
      return json({ ...session, history: visible, historyTotal: total })
    }
    if (path.startsWith('/session/rename/')) { session.title = body.title; return json(session) }
    if (path.startsWith('/session/remove/')) { sessions.delete(id); return json({ ok: true }) }
    if (path.startsWith('/session/rollback/redo/')) {
      session.history = session.redo || []
      session.redo = []
      session.undoable = 0
      return json({ ...session, restored: [] })
    }
    if (path.startsWith('/session/rollback/')) {
      session.redo = session.history
      session.history = []
      session.undoable = 1
      return json({ ...session, restored: [] })
    }
    if (path.startsWith('/agent/send/')) {
      // 新消息代表新的时间线，之前的回退不能再撤销。
      session.undoable = 0
      session.redo = []
      const number = session.history.filter(item => item.role === 'user' && !item.internal).length + 1
      session.history.push({ messageId: `user-${number}`, id: `core-user-${number}`, role: 'user', content: body.input })
      await json({ ok: true })
      if (body.input === 'keep running') {
        session.running = true
        return emit(id, [{ type: 'agent-start' }, { type: 'llm-start', startedAt: Date.now() - 5000 }, { type: 'text-delta', text: '正在处理' }])
      }
      if (body.input === 'keep waiting') {
        session.running = true
        // 只发 agent-start，故意不发 llm-start：界面必须在按下发送后就有请求状态。
        return emit(id, [{ type: 'agent-start' }])
      }
      const text = '已收到你的想法。\n\n**接下来**，我们可以一步步实现。'
      session.history.push({
        messageId: `assistant-${number}`,
        role: 'assistant',
        usage: { input: 30, output: 20, cacheRead: 10, total: 50, firstTokenMs: 200, generationMs: 800, durationMs: 800, provider: 'Test Provider', model: 'test-model', startedAt: Date.now() - 800, finishedAt: Date.now() },
        content: [
          { type: 'text', text },
          {
            type: 'tool-invocation',
            toolCallId: `finish-${number}`,
            toolName: 'attempt_completion',
            state: 'result',
            args: { result: text },
            result: { output: { type: 'text', value: text } },
          },
        ],
      })
      session.title = '一个新的项目'
      return emit(id, [{ type: 'agent-start' }, { type: 'llm-start', startedAt: Date.now() - 900 }, { type: 'text-delta', text: '已收到' }, { type: 'text-delta', text: '你的想法。' }, { type: 'llm-finish', text, usage: { input: 30, output: 20, cacheRead: 10, total: 50, firstTokenMs: 200, generationMs: 800, durationMs: 800, provider: 'Test Provider', model: 'test-model' } }, { type: 'title', title: '一个新的项目' }, { type: 'agent-finish' }])
    }
    if (path.startsWith('/agent/stop/')) {
      session.running = false
      session.pending = []
      // 真实后端会保存停止前已经流出的半段回复；mock 也写进历史，刷新后不能丢。
      const partial = body?.partial
      if (partial?.content || partial?.reasoning) {
        session.history.push({
          messageId: 'assistant-stopped',
          role: 'assistant',
          content: [
            ...(partial.reasoning ? [{ type: 'reasoning', text: partial.reasoning }] : []),
            ...(partial.content ? [{ type: 'text', text: partial.content }] : []),
          ],
        })
      }
      await json({ ok: true })
      return emit(id, [{ type: 'agent-finish', reason: 'stopped' }])
    }
    if (path.startsWith('/agent/resume/')) {
      session.running = false
      // 真实后端会先追加一条内部提示和助手回复，再返回并推 SSE；
      // 先落 history 再 fulfill，避免前端 agent-finish 刷新时读到旧历史。
      session.history.push({ messageId: 'internal-continue', role: 'user', internal: true, content: CONTINUE_TEXT })
      session.history.push({ messageId: 'assistant-2', role: 'assistant', usage: { input: 12, output: 6, total: 18, firstTokenMs: 300, generationMs: 600, durationMs: 600, provider: 'Test Provider', model: 'test-model' }, content: [{ type: 'text', text: '继续完成' }] })
      await json({ ok: true })
      return emit(id, [
        { type: 'agent-resume' },
        { type: 'llm-start', startedAt: Date.now() - 700 },
        { type: 'text-delta', text: '继续完成' },
        { type: 'llm-finish', text: '继续完成', usage: { input: 12, output: 6, total: 18, firstTokenMs: 300, generationMs: 600, durationMs: 600, provider: 'Test Provider', model: 'test-model' } },
        { type: 'agent-finish' },
      ])
    }
    if (path.startsWith('/agent/decide/')) {
      session.pending = session.pending.filter(item => (item.callID || item.toolCallId) !== body.toolCallId)
      return json({ ok: true })
    }
    return route.fulfill({ status: 500, json: { error: `Unexpected API: ${method} ${path}` } })
  })
  return { calls, sessions, errors, emit, config: () => config, setHealth: value => { healthState = { ...healthState, ...value } } }
}

// 手机没有常驻主页，会话列表在左侧抽屉；桌面横向布局下抽屉常驻、菜单按钮隐藏。
export async function openDrawer(page) {
  const menu = page.getByRole('button', { name: '打开会话抽屉', exact: true })
  const drawer = page.locator('.app-drawer')
  // 自有 关闭时还会短暂保留 open 属性和 leaving 类名；等它真正离场，
  // 否则会把“正在关闭”误判成已打开，接着点到一个不可见的会话行。
  const closing = await drawer.evaluate(element => element.classList.contains('ui-drawer--leaving')).catch(() => false)
  if (closing) await expect(drawer).not.toHaveClass(/ui-drawer--leaving/)
  const dialog = page.getByRole('dialog', { name: '项目与会话' })
  if (await menu.isVisible() && !await dialog.isVisible()) await menu.click()
  await expect(dialog).toBeVisible()
}

export async function navigate(page, name) {
  const drawer = page.getByRole('dialog', { name: '项目与会话' })
  if (name === '新建对话') {
    // 新建对话入口已从顶栏移到抽屉底部。
    await openDrawer(page)
    await drawer.getByRole('button', { name: '新建对话', exact: true }).click()
    // 关闭动画结束后 goHome 才完成，草稿也才会清空；先等抽屉消失再输入。
    await expect(drawer).toBeHidden()
    await expect(page.locator('.draft-panel')).toBeVisible()
    return
  }
  if (name === '设置') {
    // 设置入口已从抽屉移到顶栏；抽屉开着时先关掉，避免遮住顶栏。
    if (await drawer.isVisible()) await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await expect(page.getByRole('heading', { name: '设置', exact: true, level: 1 })).toBeVisible()
    return
  }
  await openDrawer(page)
  await drawer.getByRole('button', { name, exact: true }).first().click()
  await expect(drawer).toBeHidden()
}

