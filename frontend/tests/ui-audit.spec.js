import { expect, test } from '@playwright/test'

async function backend(page, { configured = true } = {}) {
  let config = { providers: configured ? [{ name: 'Test Provider', enabled: true, baseURL: 'https://model.example.test/v1', apiKey: 'test-only-key', models: ['test-model'], headers: { 'x-preserve': 'yes' }, modelSettings: { 'test-model': { context: 64000 } } }] : [], prompt: { system: 'Be helpful.', summary: 'Keep this.' }, permission: { '*': 'ask', shell: { '*': 'ask' } }, mcp: { sample: { url: 'https://mcp.example.test' } } }
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
    const body = request.postDataJSON()
    calls.push({ path, method, body })
    const json = data => route.fulfill({ status: 200, json: data })
    if (path === '/config/read') return json(config)
    if (path === '/config/set') { config = body; return json(config) }
    if (path === '/session/create') {
      const id = `session-${sessions.size + 1}`
      sessions.set(id, { id, title: body.title, provider: body.provider, model: body.model, history: [], createdAt: Date.now(), updatedAt: Date.now() })
      return json({ sessionId: id })
    }
    const id = path.split('/').at(-1)
    const session = sessions.get(id)
    if (path.startsWith('/sse/connect/')) {
      if (queued.has(id)) { const eventBody = queued.get(id); queued.delete(id); return route.fulfill({ contentType: 'text/event-stream', body: eventBody }) }
      waiting.set(id, route)
      return
    }
    if (!session) return route.fulfill({ status: 404, json: { error: 'Session not found' } })
    if (path.startsWith('/session/read/')) return json(session)
    if (path.startsWith('/session/rename/')) { session.title = body.title; return json(session) }
    if (path.startsWith('/session/remove/')) { sessions.delete(id); return json({ ok: true }) }
    if (path.startsWith('/session/rollback/')) { session.redo = session.history; session.history = []; return json(session) }
    if (path.startsWith('/session/redo/')) { session.history = session.redo || []; return json(session) }
    if (path.startsWith('/agent/send/')) {
      session.history.push({ messageId: 'user-1', id: 'core-user-1', role: 'user', content: body.input })
      await json({ ok: true })
      if (body.input === 'keep running') return emit(id, [{ type: 'agent-start' }, { type: 'text-delta', text: '正在处理' }])
      const text = '已收到你的想法。\n\n**接下来**，我们可以一步步实现。'
      session.history.push({ messageId: 'assistant-1', role: 'assistant', content: [{ type: 'text', text }] })
      return emit(id, [{ type: 'agent-start' }, { type: 'text-delta', text: '已收到' }, { type: 'text-delta', text: '你的想法。' }, { type: 'llm-finish', text, usage: { inputTokens: 30, outputTokens: 20 } }, { type: 'agent-finish' }])
    }
    if (path.startsWith('/agent/stop/')) { await json({ ok: true }); return emit(id, [{ type: 'agent-finish' }]) }
    if (path.startsWith('/agent/decide/')) return json({ ok: true })
    return route.fulfill({ status: 500, json: { error: `Unexpected API: ${method} ${path}` } })
  })
  return { calls, sessions, errors, emit, config: () => config }
}

async function navigate(page, name) {
  const menu = page.getByRole('button', { name: '打开导航', exact: true })
  if (await menu.isVisible()) await menu.click()
  await page.getByRole('button', { name, exact: true }).click()
}

async function screenshot(page, testInfo, name) {
  const layout = await page.evaluate(() => ['html', 'body', 'm3e-theme', '.preview-page', '.app-content', '.app-view', '.chat-page', '.chat-composer'].map(selector => {
    const element = document.querySelector(selector)
    if (!element) return null
    const box = element.getBoundingClientRect()
    return { selector, left: box.left, width: box.width, scrollLeft: element.scrollLeft, scrollWidth: element.scrollWidth }
  }))
  expect(layout.filter(Boolean).every(item => item.scrollLeft === 0), JSON.stringify(layout)).toBe(true)
  if (testInfo.project.name === 'mobile') expect(layout.find(item => item.selector === '.app-content').left).toBe(0)
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true, animations: 'disabled' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0)
}

test('empty home, accessible navigation and unsupported capabilities', async ({ page }, testInfo) => {
  const mock = await backend(page, { configured: false })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '你好，今天想聊些什么？' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeVisible()
  await screenshot(page, testInfo, 'home')
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('searchbox', { name: '搜索会话' })).toBeFocused()
  await page.getByRole('searchbox').fill('不存在的关键词')
  await expect(page.getByText('没有找到相关会话')).toBeVisible()
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: '收起侧边栏' }).click()
  await navigate(page, '设置')
  await expect(page.getByRole('heading', { name: '通用', exact: true, level: 2 })).toBeVisible()
  if (testInfo.project.name === 'desktop') await expect(page.getByRole('button', { name: /工具管理/ })).toBeDisabled()
  await screenshot(page, testInfo, 'settings')
  expect(mock.calls.some(call => /workspace|health|login|session\/update/.test(call.path))).toBe(false)
  expect(mock.errors).toEqual([])
})

test('real contract: create, stream, rename, persistence, rollback and delete', async ({ page }, testInfo) => {
  const mock = await backend(page)
  await page.goto('/')
  await expect(page.getByLabel('新对话使用的模型')).toHaveValue(JSON.stringify(['Test Provider', 'test-model']))
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('一个新的项目')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.markdown-body')).toContainText('一步步实现')
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0)
  await screenshot(page, testInfo, 'chat')
  await page.getByRole('button', { name: '回退到此消息' }).click()
  await page.getByRole('button', { name: '确认回退', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('一个新的项目')
  await page.getByRole('button', { name: '撤销回退', exact: true }).click()
  await expect(page.locator('.markdown-body')).toContainText('一步步实现')
  await navigate(page, '主页')
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: '打开导航' }).click()
  await page.locator('.session-row').hover()
  await page.getByRole('button', { name: '重命名 一个新的项目', exact: true }).click()
  await page.getByRole('textbox', { name: '会话名称' }).fill('我的计划')
  await page.getByRole('button', { name: '保存名称', exact: true }).click()
  await page.reload()
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: '打开导航' }).click()
  await page.locator('.session-row').hover()
  await expect(page.locator('.session-row')).toContainText('我的计划')
  await page.getByRole('button', { name: '删除 我的计划', exact: true }).click()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.locator('.session-row')).toHaveCount(1)
  await page.getByRole('button', { name: '删除 我的计划', exact: true }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.locator('.session-row')).toHaveCount(0)
  expect(mock.calls.find(call => call.path.startsWith('/session/rollback/')).body).toEqual({ messageId: 'user-1' })
  expect(mock.errors).toEqual([])
})

test('settings save preserves uneditable backend configuration and secrets stay out of storage', async ({ page }, testInfo) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '设置')
  await page.getByRole('button', { name: '模型供应商', exact: true }).click()
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
  expect(mock.calls.find(call => call.path === '/agent/decide/session-1').body).toEqual({ callId: 'call-1', decision: 'allow-always' })
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
  await expect(page.getByRole('heading', { name: '你好，今天想聊些什么？' })).toBeVisible()
  await expect(page.getByRole('button', { name: '重试', exact: true })).toBeVisible()
})

test('settings close keeps the chat draft and failed save keeps the dialog open', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  const editor = page.getByRole('textbox', { name: '消息', exact: true })
  await editor.fill('尚未发送的草稿')
  await page.getByRole('button', { name: '对话设置' }).click()
  await page.getByRole('switch', { name: '增强键盘焦点' }).check()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '设置', exact: true })).toHaveCount(0)
  await expect(editor).toHaveValue('尚未发送的草稿')
  expect(mock.calls.some(call => call.path === '/config/set')).toBe(false)
  await page.getByRole('button', { name: '对话设置' }).click()
  await page.getByRole('button', { name: '模型供应商', exact: true }).click()
  await page.getByRole('textbox', { name: '供应商名' }).fill('')
  await page.getByRole('button', { name: '关闭设置' }).click()
  await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('供应商名称不能为空或重复')
  await page.getByRole('textbox', { name: '供应商名' }).fill('Test Provider')
  await page.getByRole('button', { name: '关闭设置' }).click()
  await expect(editor).toHaveValue('尚未发送的草稿')
  expect(mock.errors).toEqual([])
})
