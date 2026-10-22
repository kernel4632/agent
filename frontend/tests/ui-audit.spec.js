import { expect, test } from '@playwright/test'

async function backend(page, { configured = true } = {}) {
  let config = { providers: configured ? [{ name: 'Test Provider', enabled: true, baseURL: 'https://model.example.test/v1', apiKey: 'test-only-key', models: ['test-model'], headers: { 'x-preserve': 'yes' }, modelSettings: { 'test-model': { context: 64000 } } }] : [], prompt: { system: 'Be helpful.', summary: 'Keep this.' }, permission: { '*': 'ask', execute_command: { '*': 'ask' } }, mcp: { sample: { url: 'https://mcp.example.test' } }, rules: { enabled: true }, modes: {}, diagnostics: {}, snapshot: {} }
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
      {
        name: 'read_file', kind: 'read', permission: 'ask', configurable: true,
        ui: { view: 'file-read', icon: 'document', title: '读取文件', summary: '{path}' },
      },
      {
        name: 'execute_command', kind: 'command', permission: 'ask', configurable: true,
        ui: { view: 'command', icon: 'code', title: '执行命令', summary: '{command}' },
      },
      {
        name: 'new_task', kind: 'subtask', permission: 'ask', configurable: true,
        ui: { view: 'subtask', icon: 'branch', title: '创建子任务', summary: '{description}' },
      },
      {
        name: 'update_todo_list', kind: 'never', permission: 'ask', configurable: false,
        ui: { view: 'todo', icon: 'check', title: '任务清单', summary: '当前进度' },
      },
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
      if (body.input === 'keep running') {
        session.running = true
        return emit(id, [{ type: 'agent-start' }, { type: 'text-delta', text: '正在处理' }])
      }
      const text = '已收到你的想法。\n\n**接下来**，我们可以一步步实现。'
      session.history.push({ messageId: 'assistant-1', role: 'assistant', content: [{ type: 'text', text }] })
      session.title = '一个新的项目'
      return emit(id, [{ type: 'agent-start' }, { type: 'text-delta', text: '已收到' }, { type: 'text-delta', text: '你的想法。' }, { type: 'llm-finish', text, usage: { inputTokens: 30, outputTokens: 20 } }, { type: 'title', title: '一个新的项目' }, { type: 'agent-finish' }])
    }
    if (path.startsWith('/agent/stop/')) { session.running = false; await json({ ok: true }); return emit(id, [{ type: 'agent-finish' }]) }
    if (path.startsWith('/agent/decide/')) return json({ ok: true })
    return route.fulfill({ status: 500, json: { error: `Unexpected API: ${method} ${path}` } })
  })
  return { calls, sessions, errors, emit, config: () => config }
}

// 手机没有常驻主页，会话列表在左侧抽屉；桌面横向布局下抽屉常驻、菜单按钮隐藏。
async function openDrawer(page) {
  const menu = page.getByRole('button', { name: '打开会话抽屉', exact: true })
  if (await menu.isVisible()) {
    // 手机抽屉关闭时带 0.22s 滑出动画；等它完全隐藏再点菜单，避免点到正在移动的按钮。
    const drawer = page.locator('.app-drawer')
    const open = await drawer.evaluate(element => element.classList.contains('is-open')).catch(() => false)
    if (!open) {
      await expect(drawer).toBeHidden()
      await menu.click()
    }
  }
  await expect(page.getByRole('region', { name: '项目与会话' })).toBeVisible()
}

async function navigate(page, name) {
  await openDrawer(page)
  const drawer = page.getByRole('region', { name: '项目与会话' })
  if (name === '新建对话') return drawer.getByRole('button', { name: '新建对话', exact: true }).click()
  if (name === '设置') return drawer.getByRole('button', { name: '设置', exact: true }).click()
  return drawer.getByRole('button', { name, exact: true }).first().click()
}

async function screenshot(page, testInfo, name) {
  const layout = await page.evaluate(() => ['html', 'body', 'm3e-theme', '.rikka-app', '.rikka-main', '.app-main', '.app-drawer', '.topbar', '.chat-composer'].map(selector => {
    const element = document.querySelector(selector)
    if (!element) return null
    const box = element.getBoundingClientRect()
    return { selector, left: box.left, width: box.width, scrollLeft: element.scrollLeft, scrollWidth: element.scrollWidth }
  }))
  expect(layout.filter(Boolean).every(item => item.scrollLeft === 0), JSON.stringify(layout)).toBe(true)
  if (testInfo.project.name === 'mobile') expect(layout.find(item => item.selector === '.rikka-main').left).toBe(0)
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true, animations: 'disabled' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0)
}

test('empty chat and drawer, accessible navigation and unsupported capabilities', async ({ page }, testInfo) => {
  const mock = await backend(page, { configured: false })
  await page.goto('/')
  await openDrawer(page)
  await expect(page.getByRole('region', { name: '项目与会话' })).toBeVisible()
  await page.getByRole('region', { name: '项目与会话' }).getByRole('button', { name: '搜索对话', exact: true }).click()
  await expect(page.getByRole('searchbox', { name: '搜索会话' })).toBeVisible()
  await screenshot(page, testInfo, 'drawer')
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
  await navigate(page, '设置')
  await expect(page.getByRole('heading', { name: '设置', exact: true, level: 1 })).toBeVisible()
  const general = page.getByRole('button', { name: /通用/ })
  await expect(general).toBeVisible()
  await expect(general).toBeEnabled()
  if (testInfo.project.name === 'desktop') await expect(page.getByRole('button', { name: /工具管理/ })).toBeEnabled()
  await screenshot(page, testInfo, 'settings')
  await general.click()
  await expect(page.getByRole('heading', { name: '通用', exact: true, level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: '通用', exact: true, level: 3 })).toBeVisible()
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
  await page.getByRole('button', { name: '回退到这条消息' }).click()
  await page.getByRole('button', { name: '确认回退', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('一个新的项目')
  await page.getByRole('button', { name: '撤销回退', exact: true }).click()
  await expect(page.locator('.markdown-body')).toContainText('一步步实现')
  await openDrawer(page)
  const created = page.locator('.home-session').filter({ hasText: '一个新的项目' })
  await created.hover()
  await created.locator('.home-session__menu summary').click()
  await page.getByRole('button', { name: '重命名', exact: true }).click()
  await page.getByRole('textbox', { name: '会话名称' }).fill('我的计划')
  await page.getByRole('button', { name: '保存名称', exact: true }).click()
  await page.reload()
  await openDrawer(page)
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
  expect(mock.calls.find(call => call.path === '/session/rollback/preview/session-1').body).toEqual({ messageId: 'user-1' })
  expect(mock.errors).toEqual([])
})

test('assistant reply block can be rolled back to that reply', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('你好')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.markdown-body')).toContainText('一步步实现')

  await page.locator('.message--assistant').first().hover()
  await page.getByRole('button', { name: '回退到这条回复', exact: true }).click()
  await expect(page.getByRole('heading', { name: '回到这条回复之前？', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '确认回退', exact: true }).click()

  await expect.poll(() => mock.calls.find(call => call.path === '/session/rollback/session-1')?.body)
    .toEqual({ messageId: 'assistant-1', files: true })
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('')
  await expect(page.getByRole('button', { name: '撤销回退', exact: true })).toBeVisible()
  expect(mock.errors).toEqual([])
})

test('settings auto-save preserves uneditable backend configuration and secrets stay out of storage', async ({ page }, testInfo) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '设置')
  await page.getByRole('button', { name: /模型供应商/ }).click()
  await expect(page.getByRole('textbox', { name: '供应商名' })).toBeVisible()
  await screenshot(page, testInfo, 'settings-providers')
  await page.getByRole('textbox', { name: '供应商名' }).fill('Renamed provider')
  await page.getByRole('textbox', { name: '手动添加模型 ID' }).fill('another-model')
  await page.getByRole('button', { name: '添加模型', exact: true }).click()
  await expect.poll(() => mock.config().providers[0].models).toEqual(['test-model', 'another-model'])
  const saved = mock.config()
  expect(saved.prompt.summary).toBe('Keep this.')
  expect(saved.permission).toEqual({ '*': 'ask', execute_command: { '*': 'ask' } })
  expect(saved.mcp.sample.url).toBe('https://mcp.example.test')
  expect(saved.providers[0].headers).toEqual({ 'x-preserve': 'yes' })
  expect(saved.providers[0].modelSettings['test-model'].context).toBe(64000)
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('test-only-key')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await page.getByRole('button', { name: /通用/ }).click()
  await page.getByRole('radio', { name: '浅色', exact: true }).check()
  await expect(page.locator('m3e-theme')).toHaveAttribute('scheme', 'light')
  await screenshot(page, testInfo, 'appearance-light')
  await page.getByRole('radio', { name: '深色', exact: true }).check()
  await expect(page.locator('m3e-theme')).toHaveAttribute('scheme', 'dark')
  await screenshot(page, testInfo, 'appearance')
  const writes = mock.calls.filter(call => call.path === '/config/set').length
  await page.getByRole('switch', { name: '减少界面动画' }).check()
  await expect(page.locator('m3e-theme')).toHaveAttribute('reduced-motion', '')
  await page.waitForTimeout(700)
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

test('tool row renders the ui declared by the tool', async ({ page }, testInfo) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('keep running')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeVisible()

  await mock.emit('session-1', [
    { type: 'agent-start' },
    { type: 'tool-call', toolCallId: 'todo-1', toolName: 'update_todo_list', input: { todos: '- [x] 读现有实现\n- [-] 改 session 指令\n- [ ] 补测试' } },
    { type: 'tool-result', toolCallId: 'todo-1', toolName: 'update_todo_list', output: { type: 'json', value: { items: [
      { text: '读现有实现', status: 'completed' },
      { text: '改 session 指令', status: 'in_progress' },
      { text: '补测试', status: 'pending' },
    ] } } },
  ])

  const label = page.getByText('任务清单 · 当前进度', { exact: true })
  await expect(label).toBeVisible()
  await label.click()
  await expect(page.getByText('读现有实现', { exact: true })).toBeVisible()
  await expect(page.getByText('补测试', { exact: true })).toBeVisible()
  await expect(page.locator('.todo-item__status')).toHaveText(['已完成', '进行中', '待处理'])
  await screenshot(page, testInfo, 'tool-todo')
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

test('retry keeps the stop button available after reconnecting', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('keep running')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible()

  // 刷新会重新读取会话；后端仍在 running，输入区必须继续显示停止按钮。
  await page.reload()
  await openDrawer(page)
  await page.locator('.home-session__main').filter({ hasText: '新对话' }).click()
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible()

  await mock.emit('session-1', [{ type: 'retry', attempt: 1 }])
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '停止生成', exact: true }).click()
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeVisible()
  expect(mock.errors).toEqual([])
})

test('connection failure is visible and does not replace the page with a blank screen', async ({ page }) => {
  await page.route('**/api/config/read', route => route.fulfill({ status: 503, body: 'Unavailable' }))
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('无法连接后端')
  await openDrawer(page)
  await expect(page.getByRole('region', { name: '项目与会话' })).toBeVisible()
  await expect(page.getByRole('button', { name: '重试', exact: true })).toBeVisible()
})

test('settings auto-save on change and back keeps the chat draft', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  const editor = page.getByRole('textbox', { name: '消息', exact: true })
  await editor.fill('尚未发送的草稿')
  await navigate(page, '设置')
  await page.getByRole('button', { name: /高级/ }).click()
  await page.getByRole('switch', { name: '读取项目规则' }).click()
  await expect.poll(() => mock.calls.some(call => call.path === '/config/set')).toBe(true)
  await page.waitForTimeout(200)
  await page.keyboard.press('Escape')
  await expect(page.locator('.settings-screen')).toHaveCount(0)
  await expect(editor).toHaveValue('尚未发送的草稿')

  await navigate(page, '设置')
  await page.getByRole('button', { name: /模型供应商/ }).click()
  await page.getByRole('textbox', { name: '供应商名' }).fill('')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.locator('.settings-screen')).toBeVisible()
  await expect(page.getByRole('status')).toContainText('供应商名称不能为空或重复')
  await page.getByRole('button', { name: /模型供应商/ }).click()
  await page.getByRole('textbox', { name: '供应商名' }).fill('Test Provider')
  await expect.poll(() => mock.config().providers[0].name).toBe('Test Provider')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await page.getByRole('button', { name: '返回', exact: true }).click()
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
  await page.locator('.session-model').selectOption({ label: 'another-model (Test Provider)' })
  await expect.poll(() => mock.calls.find(call => call.path === '/session/model/session-1')?.body)
    .toEqual({ provider: 'Test Provider', model: 'another-model' })
  await expect(page.locator('.session-model')).toHaveValue('Test Provider/another-model')
})

test('advanced, tools and MCP settings write back', async ({ page }, testInfo) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '设置')

  await page.getByRole('button', { name: /高级/ }).click()
  await screenshot(page, testInfo, 'settings-advanced')
  await page.getByRole('switch', { name: '读取项目规则' }).click()
  await expect(page.getByRole('switch', { name: '读取项目规则' })).not.toBeChecked()
  await page.getByLabel('命令', { exact: true }).fill('bun run typecheck')
  await page.getByRole('switch', { name: '记录 shell 改动' }).click()
  await expect(page.getByRole('switch', { name: '记录 shell 改动' })).toBeChecked()
  await page.getByLabel('自定义模式 JSON').fill(JSON.stringify({ review: { label: '审查', tools: ['read_file'] } }, null, 2))
  await page.getByRole('button', { name: '应用模式', exact: true }).click()

  await page.getByRole('button', { name: '返回', exact: true }).click()
  await page.getByRole('button', { name: /工具管理/ }).click()
  await expect(page.getByText('read_file')).toBeVisible()
  await expect(page.getByText('execute_command')).toBeVisible()
  await screenshot(page, testInfo, 'settings-tools')

  await page.getByRole('button', { name: '返回', exact: true }).click()
  await page.getByRole('button', { name: /MCP 服务/ }).click()
  await expect(page.getByText('sample', { exact: true })).toBeVisible()
  await screenshot(page, testInfo, 'settings-mcp')

  await expect.poll(() => mock.config().rules.enabled).toBe(false)
  await expect.poll(() => mock.config().diagnostics.command).toBe('bun run typecheck')
  const saved = mock.config()
  expect(saved.snapshot.shell).toBe(true)
  expect(saved.modes.review).toEqual({ label: '审查', tools: ['read_file'] })
})

test('message action forks the conversation at that message', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('你好')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.markdown-body')).toContainText('一步步实现')
  await page.locator('.message--user').first().hover()
  await page.locator('.message--user').first().getByRole('button', { name: '从这里分支', exact: true }).click()
  await expect.poll(() => mock.calls.find(call => call.path === '/session/fork/session-1')?.body)
    .toEqual({ messageId: 'user-1' })
})

test('message favorites and session stats use existing data', async ({ page }, testInfo) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('你好')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.markdown-body')).toContainText('一步步实现')

  await page.locator('.message--user').first().hover()
  await page.locator('.message--user').first().getByRole('button', { name: '收藏消息', exact: true }).click()
  await openDrawer(page)
  const drawer = page.getByRole('region', { name: '项目与会话' })
  await drawer.getByRole('button', { name: '收藏的消息', exact: true }).click()
  const favorites = page.getByRole('dialog', { name: '收藏的消息' })
  await expect(favorites).toContainText('一个新的项目')
  await expect(favorites).toContainText('你好')
  await screenshot(page, testInfo, 'favorites-dialog')
  await favorites.getByRole('button', { name: '关闭', exact: true }).click()

  await drawer.getByRole('button', { name: '会话统计', exact: true }).click()
  const stats = page.getByRole('dialog', { name: '会话统计' })
  await expect(stats).toContainText('助手回复')
  await expect(stats).toContainText('输入 tokens')
  await stats.getByRole('button', { name: '关闭', exact: true }).click()
})

test('MCP service can be added and saved', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '设置')
  await page.getByRole('button', { name: /MCP 服务/ }).click()
  await page.getByRole('button', { name: '添加 MCP 服务', exact: true }).click()
  await expect(page.getByText('MCP 2', { exact: true })).toBeVisible()
  await page.getByLabel('启动命令').fill('npx test-server')
  await expect.poll(() => mock.config().mcp['MCP 2']?.command).toBe('npx test-server')
  const saved = mock.config()
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
