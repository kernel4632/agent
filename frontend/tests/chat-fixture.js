/*
聊天页测试夹具：拦截前端真实会用到的 /api 契约，提供可读写的内存会话。
ui-audit.spec.js 和 ui-motion.spec.js 共用这一份，避免两套 mock 对同一接口给出不同行为。
调用示例：
  const mock = await backend(page)
  await navigate(page, '新建对话')
  await mock.emit('session-1', [{ type: 'agent-finish' }])
*/
import { expect } from '@playwright/test'

export async function backend(page, { configured = true } = {}) {
  let config = { providers: configured ? [{ name: 'Test Provider', enabled: true, baseURL: 'https://model.example.test/v1', apiKey: 'test-only-key', models: ['test-model'], headers: { 'x-preserve': 'yes' }, modelSettings: { 'test-model': { context: 64000 } } }] : [], prompt: { system: 'Be helpful.', summary: 'Keep this.' }, permission: { '*': 'ask', execute_command: { '*': 'ask' } }, mcp: { sample: { url: 'https://mcp.example.test' } }, rules: { enabled: true }, agents: {}, diagnostics: {}, snapshot: {} }
  const sessions = new Map()
  const calls = []
  const waiting = new Map()
  const queued = new Map()
  const errors = []
  const CONTINUE_TEXT = '继续上次未完成的任务，从现有进度接着做，不要重复已经完成的内容；完成后调用结束工具。' // 真实后端隐藏的内部提示
  page.on('pageerror', error => errors.push(error.message))
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
    const route = waiting.get(id)
    if (route) { waiting.delete(id); await route.fulfill({ status: 200, contentType: 'text/event-stream', body }) }
    else queued.set(id, body)
  }
  await page.route('**/api/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace('/api', '')
    const method = request.method()
    const body = request.postData() ? request.postDataJSON() : undefined
    calls.push({ path, method, body })
    const json = data => route.fulfill({ status: 200, json: data })
    if (path === '/config/read') return json(config)
    if (path === '/config/set') { config = body; return json(config) }
    if (path === '/config/test') return json({ ok: true, provider: body?.provider, model: body?.model, text: 'ok' })
    if (path === '/session/list') return json([...sessions.values()])
    if (path === '/workspace/read') return json({ path: 'D:/mock-workspace', files: ['src/main.js', 'README.md'], git: null })
    if (path === '/health') return json({ ok: true, version: 'test', sessions: sessions.size, running: 0 })
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
        name: 'write_to_file', kind: 'write', kindLabel: '写入', kindHint: '改文件、打补丁不用问', permission: 'ask', configurable: true,
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
    if (path === '/agent/list') return json([
      { name: 'build', label: '执行', description: '可以改文件、执行命令', readOnly: false, tools: null, model: null, permission: null, builtin: true },
      { name: 'plan', label: '计划', description: '只读工具，先看清再动手', readOnly: true, tools: null, model: null, permission: null, builtin: true },
      { name: 'ask', label: '问答', description: '只回答和解释，不碰文件', readOnly: true, tools: [], model: null, permission: null, builtin: true },
      { name: 'debug', label: '调试', description: '复现、定位、最小修复', readOnly: false, tools: null, model: null, permission: null, builtin: true },
      ...Object.entries(config.agents || {}).map(([name, value]) => ({
        name,
        label: value?.label || name,
        description: value?.description || '',
        readOnly: value?.readOnly === true,
        tools: value?.tools || null,
        model: value?.model || null,
        permission: value?.permission || null,
        builtin: false,
      })),
    ])
    if (path === '/command/list') return json([
      { name: 'review', description: '审查改动', prompt: '请审查当前改动。\n$ARGUMENTS' },
    ])
    if (path === '/session/create') {
      const id = `session-${sessions.size + 1}`
      sessions.set(id, {
        id,
        title: body.title,
        provider: body.provider,
        model: body.model,
        history: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        settings: {
          agent: 'build',
          autoApprove: { read: false, write: false, command: false, mcp: false, subtask: false },
          autoApproveLimit: 50,
          compactThreshold: 0.8,
          capabilities: { image: true, cache: true, stream: true },
          uses: {},
          autoTitle: true,
          reasoning: 'auto',
        },
        todos: [],
        running: false,
        pending: [],
        undoable: 0,
      })
      return json({ sessionId: id })
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
      if (queued.has(id)) { const eventBody = queued.get(id); queued.delete(id); return route.fulfill({ contentType: 'text/event-stream', body: eventBody }) }
      waiting.set(id, route)
      return
    }
    if (!session) return route.fulfill({ status: 404, json: { error: 'Session not found' } })
    if (path.startsWith('/session/settings/')) {
      if (method === 'PATCH') session.settings = { ...session.settings, ...body }
      return json(session.settings)
    }
    // 真实 Server 的 read 会过滤 internal 消息；mock 也照做，才能测到“继续提示不出现”。
    if (path.startsWith('/session/read/')) return json({ ...session, history: session.history.filter(item => !item.internal) })
    if (path.startsWith('/session/rename/')) { session.title = body.title; return json(session) }
    if (path.startsWith('/session/remove/')) { sessions.delete(id); return json({ ok: true }) }
    if (path.startsWith('/session/rollback/preview/')) return json({ messages: 1, files: [] })
    if (path.startsWith('/session/rollback/')) {
      session.redo = session.history
      session.history = []
      session.undoable = 1
      return json({ ...session, restored: [] })
    }
    if (path.startsWith('/session/redo/')) {
      session.history = session.redo || []
      session.redo = []
      session.undoable = 0
      return json({ ...session, restored: [] })
    }
    if (path.startsWith('/agent/send/')) {
      session.history.push({ messageId: 'user-1', id: 'core-user-1', role: 'user', content: body.input })
      await json({ ok: true })
      if (body.input === 'keep running') {
        session.running = true
        return emit(id, [{ type: 'agent-start' }, { type: 'llm-start' }, { type: 'text-delta', text: '正在处理' }])
      }
      const text = '已收到你的想法。\n\n**接下来**，我们可以一步步实现。'
      session.history.push({
        messageId: 'assistant-1',
        role: 'assistant',
        usage: { input: 30, output: 20, cacheRead: 10, total: 50, durationMs: 800, startedAt: Date.now() - 800, finishedAt: Date.now() },
        content: [
          { type: 'text', text },
          {
            type: 'tool-invocation',
            toolCallId: 'finish-1',
            toolName: 'attempt_completion',
            state: 'result',
            args: { result: text },
            result: { output: { type: 'text', value: text } },
          },
        ],
      })
      session.title = '一个新的项目'
      return emit(id, [{ type: 'agent-start' }, { type: 'llm-start' }, { type: 'text-delta', text: '已收到' }, { type: 'text-delta', text: '你的想法。' }, { type: 'llm-finish', text, usage: { inputTokens: 30, outputTokens: 20, inputTokenDetails: { cacheReadTokens: 10 } } }, { type: 'title', title: '一个新的项目' }, { type: 'agent-finish' }])
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
      await json({ ok: true })
      session.running = false
      // 真实后端会先追加一条内部提示，再让模型接着写；read 时必须过滤掉它。
      session.history.push({ messageId: 'internal-continue', role: 'user', internal: true, content: CONTINUE_TEXT })
      session.history.push({ messageId: 'assistant-2', role: 'assistant', usage: { input: 12, output: 6, total: 18, durationMs: 600 }, content: [{ type: 'text', text: '继续完成' }] })
      return emit(id, [
        { type: 'agent-resume' },
        { type: 'llm-start' },
        { type: 'text-delta', text: '继续完成' },
        { type: 'llm-finish', text: '继续完成', usage: { inputTokens: 12, outputTokens: 6 } },
        { type: 'agent-finish' },
      ])
    }
    if (path.startsWith('/agent/decide/')) {
      session.pending = session.pending.filter(item => (item.callID || item.toolCallId) !== body.toolCallId)
      return json({ ok: true })
    }
    return route.fulfill({ status: 500, json: { error: `Unexpected API: ${method} ${path}` } })
  })
  return { calls, sessions, errors, emit, config: () => config }
}

// 手机没有常驻主页，会话列表在左侧抽屉；桌面横向布局下抽屉常驻、菜单按钮隐藏。
export async function openDrawer(page) {
  const menu = page.getByRole('button', { name: '打开会话抽屉', exact: true })
  const drawer = page.locator('.app-drawer')
  // KIMA 关闭时还会短暂保留 open 属性和 leaving 类名；等它真正离场，
  // 否则会把“正在关闭”误判成已打开，接着点到一个不可见的会话行。
  const closing = await drawer.evaluate(element => element.classList.contains('kima-drawer--leaving')).catch(() => false)
  if (closing) await expect(drawer).not.toHaveClass(/kima-drawer--leaving/)
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
