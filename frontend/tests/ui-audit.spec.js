import { expect, test } from '@playwright/test'

async function backend(page, { configured = true } = {}) {
  let config = { providers: configured ? [{ name: 'Test Provider', enabled: true, baseURL: 'https://model.example.test/v1', apiKey: 'test-only-key', models: ['test-model'], headers: { 'x-preserve': 'yes' }, modelSettings: { 'test-model': { context: 64000 } } }] : [], prompt: { system: 'Be helpful.', summary: 'Keep this.' }, permission: { '*': 'ask', shell: { '*': 'ask' } }, mcp: { sample: { url: 'https://mcp.example.test' } }, rules: { enabled: true }, modes: {}, diagnostics: {}, snapshot: {} }
  const sessions = new Map()
  const calls = []
  const waiting = new Map()
  const queued = new Map()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  async function emit(id, events) {
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
    if (path === '/session/list') return json([...sessions.values()])
    if (path === '/workspace/read') return json({ path: 'D:/mock-workspace', files: ['src/main.js', 'README.md'], git: null })
    if (path === '/health') return json({ ok: true, version: 'test', sessions: sessions.size, running: 0 })
    if (path === '/tool/list') return json([
      { name: 'file_read', kind: 'read', permission: 'ask' },
      { name: 'shell', kind: 'command', permission: 'ask' },
      { name: 'task', kind: 'subtask', permission: 'ask' },
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
          mode: 'build',
          autoApprove: { read: false, write: false, command: false, mcp: false, subtask: false },
          autoApproveLimit: 50,
          compactThreshold: 0.8,
          capabilities: { image: true, cache: true, stream: true },
          uses: {},
          autoTitle: true,
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
    if (path.startsWith('/session/read/')) return json(session)
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
      if (body.input === 'keep running') return emit(id, [{ type: 'agent-start' }, { type: 'text-delta', text: '正在处理' }])
      const text = '已收到你的想法。\n\n**接下来**，我们可以一步步实现。'
      session.history.push({ messageId: 'assistant-1', role: 'assistant', content: [{ type: 'text', text }] })
      session.title = '一个新的项目'
      return emit(id, [{ type: 'agent-start' }, { type: 'text-delta', text: '已收到' }, { type: 'text-delta', text: '你的想法。' }, { type: 'llm-finish', text, usage: { inputTokens: 30, outputTokens: 20 } }, { type: 'title', title: '一个新的项目' }, { type: 'agent-finish' }])
    }
    if (path.startsWith('/agent/stop/')) { await json({ ok: true }); return emit(id, [{ type: 'agent-finish' }]) }
    if (path.startsWith('/agent/decide/')) return json({ ok: true })
    return route.fulfill({ status: 500, json: { error: `Unexpected API: ${method} ${path}` } })
  })
  return { calls, sessions, errors, emit, config: () => config }
}

async function navigate(page, name) {
  await page.getByRole('button', { name, exact: true }).first().click()
}

async function screenshot(page, testInfo, name) {
  const layout = await page.evaluate(() => ['html', 'body', 'm3e-theme', '.preview-page', '.app-main', '.home-panel', '.session-panel', '.chat-composer'].map(selector => {
    const element = document.querySelector(selector)
    if (!element) return null
    const box = element.getBoundingClientRect()
    return { selector, left: box.left, width: box.width, scrollLeft: element.scrollLeft, scrollWidth: element.scrollWidth }
  }))
  expect(layout.filter(Boolean).every(item => item.scrollLeft === 0), JSON.stringify(layout)).toBe(true)
  if (testInfo.project.name === 'mobile') expect(layout.find(item => item.selector === '.app-main').left).toBe(0)
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true, animations: 'disabled' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0)
}

test('empty home, accessible navigation and unsupported capabilities', async ({ page }, testInfo) => {
  const mock = await backend(page, { configured: false })
  await page.goto('/')
  await expect(page.getByRole('region', { name: '项目与会话' })).toBeVisible()
  await expect(page.getByRole('searchbox', { name: '搜索会话' })).toBeVisible()
  await screenshot(page, testInfo, 'home')
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog', { name: '命令面板' })).toBeVisible()
  await expect(page.getByRole('searchbox', { name: '搜索命令' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '命令面板' })).toHaveCount(0)
  await page.getByRole('searchbox', { name: '搜索会话' }).fill('不存在的关键词')
  await expect(page.getByText('没有找到匹配的会话')).toBeVisible()
  await page.getByRole('button', { name: '清除搜索' }).click()
  await page.getByRole('button', { name: '新建会话', exact: true }).first().click()
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeVisible()
  await screenshot(page, testInfo, 'draft')
  await page.getByRole('button', { name: '主页', exact: true }).click()
  await navigate(page, '设置')
  await expect(page.getByRole('heading', { name: '通用', exact: true, level: 2 })).toBeVisible()
  if (testInfo.project.name === 'desktop') await expect(page.getByRole('button', { name: /工具管理/ })).toBeEnabled()
  await screenshot(page, testInfo, 'settings')
  // 工作区和健康检查是启动时正常读取；这里只盯未实现的能力，不把只读请求算进来。
  expect(mock.calls.some(call => /login|session\/update/.test(call.path))).toBe(false)
  expect(mock.errors).toEqual([])
})

test('real contract: create, stream, rename, persistence, rollback and delete', async ({ page }, testInfo) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await expect(page.getByLabel('新对话使用的模型')).toHaveValue(JSON.stringify(['Test Provider', 'test-model']))
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('一个新的项目')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.markdown-body')).toContainText('一步步实现')
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0)
  await screenshot(page, testInfo, 'chat')
  if (testInfo.project.name === 'desktop') {
    await page.getByRole('button', { name: '文件面板', exact: true }).click()
    await expect(page.getByRole('complementary', { name: '文件面板' })).toBeVisible()
    await expect(page.getByText('src/main.js', { exact: true })).toBeVisible()
    await screenshot(page, testInfo, 'review')
    await page.getByRole('button', { name: '关闭文件面板', exact: true }).click()
  }
  await page.locator('.message--user').first().hover()
  await page.getByRole('button', { name: '回退到此消息' }).click()
  await page.getByRole('button', { name: '确认回退', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('一个新的项目')
  await page.getByRole('button', { name: '撤销回退', exact: true }).click()
  await expect(page.locator('.markdown-body')).toContainText('一步步实现')
  await navigate(page, '主页')
  const created = page.locator('.home-session').filter({ hasText: '一个新的项目' })
  await created.hover()
  await created.locator('.home-session__menu summary').click()
  await page.getByRole('button', { name: '重命名', exact: true }).click()
  await page.getByRole('textbox', { name: '会话名称' }).fill('我的计划')
  await page.getByRole('button', { name: '保存名称', exact: true }).click()
  await page.reload()
  const renamed = page.locator('.home-session').filter({ hasText: '我的计划' })
  await expect(renamed).toBeVisible()
  await renamed.hover()
  await renamed.locator('.home-session__menu summary').click()
  await page.getByRole('button', { name: '删除', exact: true }).click()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.locator('.home-session')).toHaveCount(1)
  await renamed.hover()
  await renamed.locator('.home-session__menu summary').click()
  await page.getByRole('button', { name: '删除', exact: true }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.locator('.home-session')).toHaveCount(0)
  expect(mock.calls.find(call => call.path.startsWith('/session/rollback/')).body).toEqual({ messageId: 'user-1' })
  expect(mock.errors).toEqual([])
})

test('settings save preserves uneditable backend configuration and secrets stay out of storage', async ({ page }, testInfo) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '设置')
  await page.getByRole('button', { name: '模型供应商', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '供应商名' })).toBeVisible()
  await screenshot(page, testInfo, 'settings-providers')
  await page.getByRole('textbox', { name: '供应商名' }).fill('Renamed provider')
  await page.getByRole('textbox', { name: '手动添加模型 ID' }).fill('another-model')
  await page.getByRole('button', { name: '添加模型', exact: true }).click()
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('设置已保存')
  const saved = mock.config()
  expect(saved.prompt.summary).toBe('Keep this.')
  expect(saved.permission).toEqual({ '*': 'ask', shell: { '*': 'ask' } })
  expect(saved.mcp.sample.url).toBe('https://mcp.example.test')
  expect(saved.providers[0].headers).toEqual({ 'x-preserve': 'yes' })
  expect(saved.providers[0].modelSettings['test-model'].context).toBe(64000)
  expect(saved.providers[0].models).toEqual(['test-model', 'another-model'])
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('test-only-key')
  await page.getByRole('button', { name: '通用', exact: true }).click()
  await page.getByRole('radio', { name: '浅色', exact: true }).check()
  await expect(page.locator('m3e-theme')).toHaveAttribute('scheme', 'light')
  await screenshot(page, testInfo, 'appearance-light')
  await page.getByRole('radio', { name: '深色', exact: true }).check()
  await expect(page.locator('m3e-theme')).toHaveAttribute('scheme', 'dark')
  await screenshot(page, testInfo, 'appearance')
  const writes = mock.calls.filter(call => call.path === '/config/set').length
  await page.getByRole('switch', { name: '减少界面动画' }).check()
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await expect(page.locator('m3e-theme')).toHaveAttribute('reduced-motion', '')
  expect(mock.calls.filter(call => call.path === '/config/set')).toHaveLength(writes)
  expect(mock.errors).toEqual([])
})

test('tool approval uses the existing allow-always decision contract', async ({ page }, testInfo) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('keep running')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeVisible()
  await mock.emit('session-1', [{ type: 'agent-start' }, { type: 'permission', callID: 'call-1', tool: 'read', input: { path: 'example.txt' } }])
  await expect(page.getByText('等待你的许可')).toBeVisible()
  await screenshot(page, testInfo, 'approval')
  await page.getByRole('button', { name: '始终允许此参数', exact: true }).click()
  await expect(page.getByText('正在执行', { exact: true })).toBeVisible()
  expect(mock.calls.find(call => call.path === '/agent/decide/session-1').body).toEqual({ toolCallId: 'call-1', decision: 'allow-always' })
  expect(mock.errors).toEqual([])
})

test('Chinese IME does not submit and stop uses the existing endpoint', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  const editor = page.getByRole('textbox', { name: '消息', exact: true })
  await editor.fill('输入法正在选字')
  await editor.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 })
  expect(mock.calls.filter(call => call.path.startsWith('/agent/send/'))).toHaveLength(0)
  await editor.fill('keep running')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await page.getByRole('button', { name: '停止生成', exact: true }).click()
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeVisible()
  expect(mock.calls.some(call => call.path === '/agent/stop/session-1')).toBe(true)
  expect(mock.errors).toEqual([])
})

test('connection failure is visible and does not replace the page with a blank screen', async ({ page }) => {
  await page.route('**/api/config/read', route => route.fulfill({ status: 503, body: 'Unavailable' }))
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('无法连接后端')
  await expect(page.getByRole('region', { name: '项目与会话' })).toBeVisible()
  await expect(page.getByRole('button', { name: '重试', exact: true })).toBeVisible()
})

test('settings close keeps the chat draft and failed save keeps the dialog open', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  const editor = page.getByRole('textbox', { name: '消息', exact: true })
  await editor.fill('尚未发送的草稿')
  await navigate(page, '设置')
  await page.getByRole('switch', { name: '增强键盘焦点' }).check()
  await page.keyboard.press('Escape')
  await expect(page.locator('.settings-screen')).toHaveCount(0)
  await expect(editor).toHaveValue('尚未发送的草稿')
  expect(mock.calls.some(call => call.path === '/config/set')).toBe(false)
  await navigate(page, '设置')
  await page.getByRole('button', { name: '模型供应商', exact: true }).click()
  await page.getByRole('textbox', { name: '供应商名' }).fill('')
  await page.getByRole('button', { name: '关闭设置' }).click()
  await expect(page.locator('.settings-screen')).toBeVisible()
  await expect(page.getByRole('status')).toContainText('供应商名称不能为空或重复')
  await page.getByRole('textbox', { name: '供应商名' }).fill('Test Provider')
  await page.getByRole('button', { name: '关闭设置' }).click()
  await expect(editor).toHaveValue('尚未发送的草稿')
  expect(mock.errors).toEqual([])
})

test('slash command expands into the prompt before sending', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  const editor = page.getByRole('textbox', { name: '消息', exact: true })
  await editor.fill('/')
  await expect(page.getByRole('option', { name: /review/ })).toBeVisible()
  await editor.press('Enter')
  await expect(editor).toHaveValue('/review ')
  await editor.type('focus')
  await editor.press('Enter')
  await expect.poll(() => mock.calls.filter(call => call.path.startsWith('/agent/send/')).at(-1)?.body?.input)
    .toBe('请审查当前改动。\nfocus')
})

test('existing conversation switches model from the session bar', async ({ page }) => {
  const mock = await backend(page)
  mock.config().providers[0].models.push('another-model')
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('你好')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.markdown-body')).toContainText('一步步实现')
  await page.locator('.session-model').selectOption({ label: 'Test Provider / another-model' })
  await expect.poll(() => mock.calls.find(call => call.path === '/session/model/session-1')?.body)
    .toEqual({ provider: 'Test Provider', model: 'another-model' })
  await expect(page.locator('.session-model')).toHaveValue('Test Provider/another-model')
})

test('conversation can be forked from the header', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('你好')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.markdown-body')).toContainText('一步步实现')
  await page.getByRole('button', { name: '创建分支', exact: true }).click()
  await expect.poll(() => mock.calls.some(call => call.path === '/session/fork/session-1')).toBe(true)
  await expect(page.getByRole('heading', { name: '一个新的项目（分支）' })).toBeVisible()
})

test('advanced, tools and MCP settings write back', async ({ page }, testInfo) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '设置')

  await page.getByRole('button', { name: '高级', exact: true }).click()
  await screenshot(page, testInfo, 'settings-advanced')
  await page.getByRole('switch', { name: '读取项目规则' }).click()
  await expect(page.getByRole('switch', { name: '读取项目规则' })).not.toBeChecked()
  await page.getByLabel('命令', { exact: true }).fill('bun run typecheck')
  await page.getByRole('switch', { name: '记录 shell 改动' }).click()
  await expect(page.getByRole('switch', { name: '记录 shell 改动' })).toBeChecked()
  await page.getByLabel('自定义模式 JSON').fill(JSON.stringify({ review: { label: '审查', tools: ['file_read'] } }, null, 2))
  await page.getByRole('button', { name: '应用模式', exact: true }).click()

  await page.getByRole('button', { name: '工具管理', exact: true }).click()
  await expect(page.getByText('file_read')).toBeVisible()
  await expect(page.getByText('shell')).toBeVisible()
  await screenshot(page, testInfo, 'settings-tools')

  await page.getByRole('button', { name: 'MCP 服务', exact: true }).click()
  await expect(page.getByText('sample', { exact: true })).toBeVisible()
  await screenshot(page, testInfo, 'settings-mcp')

  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('设置已保存')
  const saved = mock.config()
  expect(saved.rules.enabled).toBe(false)
  expect(saved.diagnostics.command).toBe('bun run typecheck')
  expect(saved.snapshot.shell).toBe(true)
  expect(saved.modes.review).toEqual({ label: '审查', tools: ['file_read'] })
})

test('message action forks the conversation at that message', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('你好')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.markdown-body')).toContainText('一步步实现')
  await page.locator('.message--user').first().hover()
  await page.getByRole('button', { name: '从这里分支', exact: true }).click()
  await expect.poll(() => mock.calls.find(call => call.path === '/session/fork/session-1')?.body)
    .toEqual({ messageId: 'user-1' })
})

test('MCP service can be added and saved', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '设置')
  await page.getByRole('button', { name: 'MCP 服务', exact: true }).click()
  await page.getByRole('button', { name: '添加 MCP 服务', exact: true }).click()
  await expect(page.getByText('MCP 2', { exact: true })).toBeVisible()
  await page.getByLabel('启动命令').fill('npx test-server')
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('设置已保存')
  const saved = mock.config()
  expect(saved.mcp['MCP 2'].command).toBe('npx test-server')
  expect(saved.mcp['MCP 2'].enabled).toBe(true)
})

test('compaction threshold is sent as a number', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('你好')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.markdown-body')).toContainText('一步步实现')
  await page.getByRole('button', { name: /自动批准/ }).click()
  const threshold = page.getByLabel('阈值', { exact: true })
  await threshold.fill('0.6')
  await threshold.press('Tab')
  await expect.poll(() => mock.calls.find(call => call.path === '/session/settings/session-1')?.body?.compactThreshold).toBe(0.6)
})
