/*
界面回归：逐条走真实契约和可访问路径（创建、流式、回退、设置、快捷键、动效）。
和 ui-motion.spec.js 共用 chat-fixture.js 的接口 mock；动效断言在另一个文件。
运行：bun run test:ui
*/
import { expect, test } from '@playwright/test'
import { backend, navigate, openDrawer } from './chat-fixture.js'

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
  const drawer = page.getByRole('dialog', { name: '项目与会话' })
  const topbar = page.locator('.topbar')
  await expect(drawer).toBeVisible()
  await expect(page.getByRole('searchbox', { name: '搜索会话' })).toBeVisible()
  // 新建对话在抽屉底部，设置在顶栏。
  await expect(drawer.getByRole('button', { name: '新建对话', exact: true })).toBeVisible()
  await expect(drawer.getByRole('button', { name: '设置', exact: true })).toHaveCount(0)
  await expect(drawer.getByText('点下面的「新建对话」开始。')).toBeVisible()
  await expect(topbar.getByRole('button', { name: '设置', exact: true })).toBeVisible()
  await expect(topbar.getByRole('button', { name: '新建对话', exact: true })).toHaveCount(0)
  await screenshot(page, testInfo, 'drawer')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '项目与会话' })).toBeHidden()
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog', { name: '命令面板' })).toBeVisible()
  await expect(page.getByRole('searchbox', { name: '搜索命令' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '命令面板' })).toHaveCount(0)
  await openDrawer(page)
  await page.getByRole('searchbox', { name: '搜索会话' }).fill('不存在的关键词')
  await expect(page.getByText('没有找到匹配的会话')).toBeVisible()
  await page.getByRole('button', { name: '清除搜索' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '项目与会话' })).toBeHidden()
  await navigate(page, '新建对话')
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeVisible()
  await screenshot(page, testInfo, 'draft')
  await page.locator('.chat-composer__expand-corner').hover()
  await screenshot(page, testInfo, 'composer-fullscreen-handle')
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
  await expect(page.getByRole('button', { name: '选择模型（当前 test-model）' })).toBeVisible()
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('一个新的项目')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.rikka-bubble--assistant .markdown-body')).toContainText('一步步实现')
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0)
  await screenshot(page, testInfo, 'chat')
  // 文件工作区面板已移除，原来的入口换成任务清单。
  await expect(page.getByRole('button', { name: '文件面板', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '任务清单', exact: true })).toBeVisible()
  await page.locator('.rikka-bubble--user').first().click({ button: 'right' })
  await page.getByRole('button', { name: '回退到这条消息' }).click()
  await page.getByRole('button', { name: '确认回退', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('一个新的项目')
  await page.getByRole('button', { name: '撤销回退', exact: true }).click()
  await expect(page.locator('.rikka-bubble--assistant .markdown-body')).toContainText('一步步实现')
  await openDrawer(page)
  const created = page.locator('.home-session').filter({ hasText: '一个新的项目' })
  await created.hover()
  await created.locator('.home-session__menu button').click()
  await screenshot(page, testInfo, 'session-menu')
  await page.getByRole('menuitemradio', { name: '重命名', exact: true }).click()
  await page.getByRole('textbox', { name: '会话标题' }).fill('我的计划')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.reload()
  await openDrawer(page)
  const renamed = page.locator('.home-session').filter({ hasText: '我的计划' })
  await expect(renamed).toBeVisible()
  await renamed.hover()
  await renamed.locator('.home-session__menu button').click()
  await page.getByRole('menuitemradio', { name: '删除', exact: true }).click()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.locator('.home-session')).toHaveCount(1)
  await renamed.hover()
  await renamed.locator('.home-session__menu button').click()
  await page.getByRole('menuitemradio', { name: '删除', exact: true }).click()
  await page.getByRole('button', { name: '删除', exact: true }).click()
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
  await expect(page.locator('.rikka-bubble--assistant .markdown-body')).toContainText('一步步实现')

  await page.locator('.rikka-bubble--assistant').first().click({ button: 'right' })
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
  await expect(page.locator('html')).toHaveAttribute('data-kima-theme', 'light')
  await screenshot(page, testInfo, 'appearance-light')
  await page.getByRole('radio', { name: '深色', exact: true }).check()
  await expect(page.locator('m3e-theme')).toHaveAttribute('scheme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-kima-theme', 'dark')
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
  // 先点决定再做整页截图：mock 的 SSE 响应读完会触发一次重连，
  // 截图太慢时旧的审批按钮已经被重连刷新替换掉，点不到是测试时序问题。
  await page.getByRole('button', { name: '始终允许此参数', exact: true }).click()
  await expect(page.getByText('正在执行', { exact: true })).toBeVisible()
  await screenshot(page, testInfo, 'approval-decided')
  expect(mock.calls.find(call => call.path === '/agent/decide/session-1').body).toEqual({ toolCallId: 'call-1', decision: 'allow-always' })
  expect(mock.errors).toEqual([])
})

test('reasoning preview stays half-open while streaming', async ({ page }, testInfo) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('keep running')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible()

  await mock.emit('session-1', [
    { type: 'agent-start' },
    { type: 'reasoning-delta', text: '先确认消息结构和工具调用顺序。'.repeat(40) },
    { type: 'tool-call', toolCallId: 'reason-1', toolName: 'read_file', input: { path: 'example.txt' } },
    { type: 'tool-result', toolCallId: 'reason-1', toolName: 'read_file', output: { type: 'text', value: 'ok' } },
  ])

  await expect(page.locator('.cot-card')).toBeVisible()
  await expect(page.locator('.cot-step--reasoning .reasoning-preview')).toHaveClass(/is-preview/)
  await expect(page.locator('.cot-step--tool')).toHaveCount(1)
  await screenshot(page, testInfo, 'reasoning-preview')
})

test('reasoning preview collapses after the llm finishes', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('keep running')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible()

  await mock.emit('session-1', [
    { type: 'agent-start' },
    { type: 'reasoning-delta', text: '先确认消息结构和工具调用顺序。'.repeat(40) },
    { type: 'tool-call', toolCallId: 'reason-1', toolName: 'read_file', input: { path: 'example.txt' } },
    { type: 'tool-result', toolCallId: 'reason-1', toolName: 'read_file', output: { type: 'text', value: 'ok' } },
    { type: 'llm-finish', text: '查完了。', usage: { inputTokens: 10, outputTokens: 4 } },
  ])

  await expect(page.locator('.cot-step--reasoning .reasoning-preview')).not.toHaveClass(/is-preview/)
  await expect(page.locator('.cot-step--reasoning .cot-collapse')).not.toHaveClass(/is-open/)
  await expect(page.locator('.cot-step--tool')).toHaveCount(1)
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
  await expect(page.locator('.cot-step--tool .cot-step__head')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.cot-step--tool .cot-step__extra')).toContainText('已更新')
  await expect(page.locator('.cot-step--tool').getByText('读现有实现', { exact: true })).toBeVisible()
  await expect(page.locator('.cot-step--tool').getByText('补测试', { exact: true })).toBeVisible()
  // 任务清单不再常驻输入框上方，改从顶栏打开右侧面板。
  await expect(page.locator('.session-todos')).toHaveCount(0)
  await page.getByRole('button', { name: '任务清单', exact: true }).click()
  const panel = page.getByRole('dialog', { name: '任务清单' })
  await expect(panel).toBeVisible()
  await expect(panel.getByText('读现有实现', { exact: true })).toBeVisible()
  await expect(panel.getByText('1 / 3')).toBeVisible()
  await expect(panel.locator('.session-todo-panel__status')).toHaveText(['已完成', '进行中', '待处理'])
  await screenshot(page, testInfo, 'tool-todo')
  await panel.getByRole('button', { name: '关闭' }).click()
  expect(mock.errors).toEqual([])
})

test('auto-continued assistant keeps non-stop text in the timeline and finish result as the reply', async ({ page }, testInfo) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('keep running')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible()

  await mock.emit('session-1', [
    { type: 'agent-start' },
    { type: 'text-delta', text: '第一段。' },
    { type: 'llm-finish', text: '第一段。', usage: { inputTokens: 10, outputTokens: 4 } },
    { type: 'tool-call', toolCallId: 'todo-1', toolName: 'update_todo_list', input: { todos: '- [ ] 继续' } },
    { type: 'tool-result', toolCallId: 'todo-1', toolName: 'update_todo_list', output: { type: 'json', value: { items: [{ text: '继续', status: 'pending' }] } } },
    { type: 'text-delta', text: '第二段。' },
    { type: 'llm-finish', text: '第二段。', usage: { inputTokens: 12, outputTokens: 5 } },
    { type: 'tool-call', toolCallId: 'done-1', toolName: 'attempt_completion', input: { result: '最终结果。' } },
    { type: 'tool-result', toolCallId: 'done-1', toolName: 'attempt_completion', output: { type: 'text', value: '最终结果。' } },
  ])

  await expect(page.locator('.rikka-bubble--assistant')).toHaveCount(1)
  await expect(page.locator('.cot-card')).toHaveCount(1)
  await expect(page.locator('.rikka-bubble--assistant')).toContainText('最终结果。')
  // 结束工具结果已完整时不再闪流式光标。
  await expect(page.locator('.rikka-bubble--assistant .stream-caret')).toHaveCount(0)
  // 非结束正文只进时间线，不能和结束工具的结果拼成一个气泡。
  await expect(page.locator('.rikka-bubble--assistant')).not.toContainText('第一段。')
  await expect(page.locator('.rikka-bubble--assistant')).not.toContainText('第二段。')
  const card = page.locator('.cot-card')
  if (await card.locator('.cot-more').count()) await card.locator('.cot-more').click()
  await expect(card).toContainText('第一段。')
  await expect(card).toContainText('第二段。')
  const order = await card.locator('.cot-step').evaluateAll(nodes => nodes.map(node => node.textContent))
  const firstText = order.findIndex(text => text.includes('第一段。'))
  const toolStep = order.findIndex(text => text.includes('任务清单'))
  const secondText = order.findIndex(text => text.includes('第二段。'))
  expect(firstText).toBeLessThan(toolStep)
  expect(toolStep).toBeLessThan(secondText)
  await expect(page.locator('.cot-step--tool')).toHaveCount(1)
  expect(await page.locator('.rikka-bubble--assistant').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
  await screenshot(page, testInfo, 'assistant-turn')
  expect(mock.errors).toEqual([])
})

test('continue resumes an interrupted assistant without a user message', async ({ page }, testInfo) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('开始')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.rikka-bubble--assistant .markdown-body')).toContainText('一步步实现')
  const session = mock.sessions.get('session-1')
  session.title = '继续测试'
  session.history = [
    { messageId: 'user-1', id: 'core-user-1', role: 'user', content: '开始' },
    { messageId: 'assistant-1', role: 'assistant', content: [{ type: 'text', text: '做到一半' }] },
  ]
  await page.reload()
  await navigate(page, '继续测试')

  await expect(page.getByText('做到一半', { exact: true })).toBeVisible()
  const resume = page.getByRole('button', { name: '继续助手', exact: true })
  await expect(resume).toBeVisible()
  await screenshot(page, testInfo, 'continue-assistant')
  await resume.click()

  await expect.poll(() => mock.calls.filter(call => call.path === '/agent/resume/session-1')).toHaveLength(1)
  await expect(page.locator('.rikka-bubble--assistant .markdown-body')).toContainText('继续完成')
  await expect(page.locator('.rikka-bubble--user')).toHaveCount(1)
  // 内部继续提示必须被 read 过滤掉，不能变成用户气泡。
  await expect(page.getByText('继续上次未完成的任务', { exact: false })).toHaveCount(0)
  await expect(page.locator('.rikka-bubble--assistant')).toHaveCount(1)
  expect(mock.errors).toEqual([])
})

test('batch selection deletes several sessions one by one', async ({ page }, testInfo) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('第一个')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.rikka-bubble--assistant .markdown-body')).toContainText('一步步实现')

  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('第二个')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.rikka-bubble--assistant .markdown-body')).toContainText('一步步实现')

  await openDrawer(page)
  await expect(page.locator('.home-session')).toHaveCount(2)
  const drawer = page.getByRole('dialog', { name: '项目与会话' })
  await drawer.getByRole('button', { name: '批量选择会话', exact: true }).click()
  const checks = drawer.getByRole('checkbox')
  await expect(checks).toHaveCount(2)
  await checks.nth(0).check()
  await checks.nth(1).check()
  await screenshot(page, testInfo, 'batch-select')
  await drawer.getByRole('button', { name: '删除 2 个会话', exact: true }).click()
  await page.getByRole('button', { name: '删除', exact: true }).click()
  // 删除是逐个请求的，等两个请求都落到 mock 再断言，避免和网络时序赛跑。
  await expect.poll(() => mock.sessions.size).toBe(0)
})

test('composer expand keeps the draft', async ({ page }, testInfo) => {
  await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  const editor = page.getByRole('textbox', { name: '消息', exact: true })
  await editor.fill('全屏草稿')
  await page.locator('.chat-composer__expand-corner').hover()
  await page.getByRole('button', { name: '全屏输入', exact: true }).click()
  await expect(page.locator('.chat-composer')).toHaveClass(/is-expanded/)
  const collapse = page.getByRole('button', { name: '退出全屏输入', exact: true })
  await expect(collapse).toHaveAttribute('aria-pressed', 'true')
  await screenshot(page, testInfo, 'composer-expanded')
  await editor.fill('全屏里修改')
  await page.locator('.chat-composer__expand-corner').hover()
  await collapse.click()
  await expect(page.locator('.chat-composer')).not.toHaveClass(/is-expanded/)
  await expect(editor).toHaveValue('全屏里修改')
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

test('stop keeps the partial assistant text and offers continue', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('keep running')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByText('正在处理', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '停止生成', exact: true }).click()
  const stopCall = mock.calls.find(call => call.path === '/agent/stop/session-1')
  expect(stopCall.body.partial).toMatchObject({ content: '正在处理' })
  await expect(page.getByText('正在处理', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '继续助手', exact: true })).toBeVisible()
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
  await expect(page.getByRole('dialog', { name: '项目与会话' })).toBeVisible()
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

test('existing conversation switches model from the input bar', async ({ page }, testInfo) => {
  const mock = await backend(page)
  mock.config().providers[0].models.push('another-model')
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('你好')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.rikka-bubble--assistant .markdown-body')).toContainText('一步步实现')
  await page.getByRole('button', { name: '选择模型（当前 test-model）' }).click()
  await screenshot(page, testInfo, 'model-sheet')
  await page.getByRole('button', { name: 'another-model', exact: true }).click()
  await expect.poll(() => mock.calls.find(call => call.path === '/session/model/session-1')?.body)
    .toEqual({ provider: 'Test Provider', model: 'another-model' })
  await expect(page.getByRole('button', { name: '选择模型（当前 another-model）' })).toBeVisible()
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
  await expect(page.getByText('read_file', { exact: true })).toBeVisible()
  await expect(page.getByText('execute_command', { exact: true })).toBeVisible()
  await screenshot(page, testInfo, 'settings-tools')

  await page.getByRole('button', { name: '返回', exact: true }).click()
  await page.getByRole('button', { name: /MCP 服务/ }).click()
  await expect(page.getByRole('button', { name: /^sample/ })).toBeVisible()
  await screenshot(page, testInfo, 'settings-mcp')

  await expect.poll(() => mock.config().rules.enabled).toBe(false)
  await expect.poll(() => mock.config().diagnostics.command).toBe('bun run typecheck')
  const saved = mock.config()
  expect(saved.snapshot.shell).toBe(true)
  expect(saved.modes.review).toEqual({ label: '审查', tools: ['read_file'] })
})

test('message action forks the conversation at that message', async ({ page }, testInfo) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('你好')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.rikka-bubble--assistant .markdown-body')).toContainText('一步步实现')
  await page.locator('.rikka-bubble--user').first().click({ button: 'right' })
  const actions = page.getByRole('dialog', { name: '消息操作', exact: true })
  await expect(actions).toContainText('你的消息')
  await expect(actions).toContainText('你好')
  await screenshot(page, testInfo, 'message-actions')
  await page.getByRole('button', { name: '从这里分支', exact: true }).click()
  await expect(actions).toBeHidden()
  await expect.poll(() => mock.calls.find(call => call.path === '/session/fork/session-1')?.body)
    .toEqual({ messageId: 'user-1' })
})

test('rename uses existing data', async ({ page }, testInfo) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('你好')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.rikka-bubble--assistant .markdown-body')).toContainText('一步步实现')

  await page.locator('.topbar__title').click()
  const rename = page.getByRole('dialog', { name: '重命名会话' })
  await expect(rename).toBeVisible()
  await screenshot(page, testInfo, 'rename-dialog')
  await rename.getByRole('button', { name: '取消', exact: true }).click()
  // 弹窗始终挂载，关闭后原生 dialog 把焦点还给打开它的标题按钮；焦点不能掉到 body。
  await expect(rename).toBeHidden()
  await expect(page.locator('.topbar__title')).toBeFocused()
})

test('MCP service can be added and saved', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '设置')
  await page.getByRole('button', { name: /MCP 服务/ }).click()
  await page.getByRole('button', { name: '添加服务', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'MCP 2' })).toBeVisible()
  await page.getByLabel('启动命令').fill('npx test-server')
  await expect.poll(() => mock.config().mcp['MCP 2']?.command).toBe('npx test-server')

  // 环境变量写错时要显示原因，不能静默丢掉；改对后才写回配置。
  const env = page.getByLabel('环境变量（JSON 格式）')
  await env.fill('{bad')
  await expect(page.getByRole('alert')).toContainText('环境变量必须是 JSON 对象')
  // 改其他字段不能把写错的 JSON 冲掉，否则用户会以为自己白改了。
  await page.getByRole('switch', { name: '启用此服务' }).click()
  await expect(env).toHaveValue('{bad')
  await expect(page.getByRole('alert')).toContainText('环境变量必须是 JSON 对象')
  await env.fill('{"API_KEY":"x"}')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect.poll(() => mock.config().mcp['MCP 2']?.env).toEqual({ API_KEY: 'x' })

  const saved = mock.config()
  expect(saved.mcp['MCP 2'].enabled).toBe(false) // 上面为了保住错误草稿把开关关掉了
})

test('compaction threshold is sent as a number', async ({ page }, testInfo) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('你好')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.rikka-bubble--assistant .markdown-body')).toContainText('一步步实现')
  await page.getByRole('button', { name: '更多选项', exact: true }).click()
  await screenshot(page, testInfo, 'composer-options')
  await page.getByRole('button', { name: '对话设置', exact: true }).click()
  // 更多选项抽屉要等关闭动画结束并归还焦点，否则焦点会被它抢回触发按钮。
  await expect(page.getByRole('dialog', { name: '更多选项' })).toBeHidden()
  // 抽屉关闭后仍留在 DOM 里，下一次打开才能复用同一个原生 dialog。
  await expect(page.locator('.app-sheet .kima-drawer__title').filter({ hasText: '更多选项' })).toHaveCount(1)
  const threshold = page.getByLabel('阈值', { exact: true })
  await threshold.fill('0.6')
  await threshold.press('Tab')
  await expect.poll(() => mock.calls.find(call => call.path === '/session/settings/session-1' && call.body?.compactThreshold !== undefined)?.body.compactThreshold).toBe(0.6)
})

test('composer exposes permission and mode controls next to the model', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('你好')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.rikka-bubble--assistant .markdown-body')).toContainText('一步步实现')

  const permission = page.getByRole('button', { name: '权限控制', exact: true })
  await expect(permission).toBeVisible()
  const composerHeight = await page.locator('.chat-composer').evaluate(element => element.getBoundingClientRect().height)
  await permission.click()
  const permissionPopup = page.getByRole('dialog', { name: '权限控制' })
  await expect(permissionPopup).toBeVisible()
  // 权限菜单是浮层，不能把输入框撑高。
  expect(await page.locator('.chat-composer').evaluate(element => element.getBoundingClientRect().height)).toBe(composerHeight)
  await permissionPopup.getByRole('checkbox', { name: '读取' }).click()
  await expect.poll(() => mock.calls.some(call => call.path === '/session/settings/session-1' && call.body?.autoApprove?.read === true)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(permissionPopup).toBeHidden()

  const mode = page.locator('.composer-mode .kima-menu__trigger')
  await expect(mode).toContainText('执行模式')
  await mode.click()
  const modePopup = page.getByRole('menu', { name: '切换模式' })
  const plan = modePopup.getByRole('menuitemradio', { name: /计划模式/ })
  await expect(plan).toBeVisible()
  await plan.click()
  await expect(modePopup).toBeHidden()
  await expect.poll(() => mock.calls.some(call => call.path === '/session/settings/session-1' && call.body?.mode === 'plan')).toBe(true)
  await expect(mode).toContainText('计划模式')

  // 320px 下三个入口仍要同时看得见，不能被挤到横向滚动里。
  await page.setViewportSize({ width: 320, height: 568 })
  const options = page.locator('.chat-composer__options')
  expect(await options.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  await expect(permission).toBeVisible()
  await expect(page.locator('.composer-mode')).toBeVisible()
  expect(mock.errors).toEqual([])
})

test('new chat mode and permissions apply to the created session', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')

  const mode = page.locator('.composer-mode .kima-menu__trigger')
  await mode.click()
  const modePopup = page.getByRole('menu', { name: '切换模式' })
  await modePopup.getByRole('menuitemradio', { name: /计划模式/ }).click()
  await expect(modePopup).toBeHidden()
  await page.getByRole('button', { name: '权限控制', exact: true }).click()
  const permissionPopup = page.getByRole('dialog', { name: '权限控制' })
  await expect(permissionPopup).toBeVisible()
  await permissionPopup.getByRole('checkbox', { name: '读取' }).click()
  await page.keyboard.press('Escape')
  await expect(permissionPopup).toBeHidden()

  await page.getByRole('textbox', { name: '消息', exact: true }).fill('你好')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.rikka-bubble--assistant .markdown-body')).toContainText('一步步实现')

  const saved = mock.calls.find(call => call.path === '/session/settings/session-1' && call.body?.mode === 'plan')
  expect(saved).toBeTruthy()
  expect(saved.body.autoApprove.read).toBe(true)
  const sendIndex = mock.calls.findIndex(call => call.path === '/agent/send/session-1')
  expect(mock.calls.indexOf(saved)).toBeLessThan(sendIndex)
  await expect(page.locator('.composer-mode .kima-menu__trigger')).toContainText('计划模式')
  expect(mock.errors).toEqual([])
})

test('KIMA select keeps one combobox, hides the native select and chooses from its listbox', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '设置')
  await page.getByRole('button', { name: /通用/ }).click()
  const card = page.locator('.appearance-card')
  await expect(card).toBeVisible()

  // 只暴露一个可访问的组合框；原生 select 退到 1x1 的屏幕阅读器兜底位置。
  const combobox = card.getByRole('combobox')
  await expect(combobox).toHaveCount(1)
  await expect(combobox).toHaveAttribute('aria-label', '强调色')
  const native = card.locator('select.kima-select__native')
  await expect(native).toHaveCount(1)
  const nativeBox = await native.boundingBox()
  expect(nativeBox.width).toBeLessThanOrEqual(1)
  expect(nativeBox.height).toBeLessThanOrEqual(1)
  const nativeStyle = await native.evaluate(element => {
    const style = getComputedStyle(element)
    return { position: style.position, clipPath: style.clipPath }
  })
  expect(nativeStyle.position).toBe('absolute')
  expect(nativeStyle.clipPath).toContain('inset')

  // 点击组合框弹出 KIMA 自己的 listbox，而不是浏览器原生下拉。
  await expect(card.getByRole('listbox')).toHaveCount(0)
  await combobox.click()
  const listbox = card.getByRole('listbox')
  await expect(listbox).toBeVisible()
  await expect(listbox).toHaveClass(/kima-select__options/)
  await expect(listbox.getByRole('option')).toHaveCount(5)
  await listbox.getByRole('option', { name: '雾蓝', exact: true }).click()

  // 选中后值写回草稿，自动保存再落到 localStorage。
  await expect(listbox).toHaveCount(0)
  await expect(combobox).toContainText('雾蓝')
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('agent.appearance') || '{}').color)).toBe('#8badf4')
  expect(mock.errors).toEqual([])
})

test('session row menu stays inside the drawer and centers on its row', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('菜单对齐')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.rikka-bubble--assistant .markdown-body')).toContainText('一步步实现')
  await openDrawer(page)

  const row = page.locator('.home-session').first()
  await expect(row).toBeVisible()
  const trigger = row.locator('.home-session__menu .kima-menu__trigger')
  const rowBox = await row.boundingBox()
  const triggerBox = await trigger.boundingBox()
  // 触发器是 40px 图标按钮，要和 48px 会话行同一个垂直中心。
  expect(triggerBox.height).toBeLessThanOrEqual(40)
  expect(Math.abs((rowBox.y + rowBox.height / 2) - (triggerBox.y + triggerBox.height / 2))).toBeLessThanOrEqual(2)

  await trigger.click()
  const popup = page.locator('.kima-menu__popup')
  await expect(popup).toBeVisible()
  const panelBox = await page.locator('.app-drawer .kima-drawer__panel').boundingBox()
  const popupBox = await popup.boundingBox()
  // 弹层贴着行右边缘展开，不能越过抽屉面板，也不能跑出视口。
  expect(popupBox.x).toBeGreaterThanOrEqual(panelBox.x - 1)
  expect(popupBox.x + popupBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1)
  expect(popupBox.y).toBeGreaterThanOrEqual(0)
  expect(popupBox.y + popupBox.height).toBeLessThanOrEqual(panelBox.y + panelBox.height + 1)

  // 只隐藏 KIMA 生成的箭头，插槽里的“更多”图标必须还在。
  await expect(trigger.locator('svg').first()).toBeVisible()
  await expect(trigger.locator('svg').last()).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(popup).toBeHidden()
  expect(mock.errors).toEqual([])
})

test('settings pages start at the top instead of keeping the previous scroll', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '设置')
  const scroll = page.locator('.settings-scroll')
  await expect(page.getByRole('heading', { name: '设置', exact: true, level: 1 })).toBeVisible()

  // 首页滚到底再打开详情，详情必须从顶部开始。
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight })
  await page.getByRole('button', { name: /模型供应商/ }).click()
  await expect(page.getByRole('heading', { name: '模型供应商', exact: true, level: 1 })).toBeVisible()
  await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBe(0)

  // 详情滚到中间再返回，首页也必须从顶部开始。
  await scroll.evaluate(element => { element.scrollTop = 600 })
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.getByRole('heading', { name: '设置', exact: true, level: 1 })).toBeVisible()
  await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBe(0)
  expect(mock.errors).toEqual([])
})

test('long attachment names stay on one line in the composer', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.locator('input[type=file]').setInputFiles({
    name: '一个非常长的附件名字用来检查附件条会不会把输入框撑破.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello'),
  })
  const chip = page.locator('.chat-composer__file')
  const text = chip.locator('.kima-chip__text')
  await expect(chip).toBeVisible()
  expect(await text.evaluate(element => getComputedStyle(element).whiteSpace)).toBe('nowrap')
  expect(await chip.evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(44)
  expect(mock.errors).toEqual([])
})

test('attachment content stays out of the user bubble', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.locator('input[type=file]').setInputFiles({
    name: '一个非常长的附件名字用来检查气泡里的文件名会不会把消息撑长.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('这段附件正文不应该出现在用户气泡里'),
  })
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('看看附件')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.rikka-bubble--assistant .markdown-body')).toContainText('一步步实现')

  const bubble = page.locator('.rikka-bubble--user')
  await expect(bubble).toContainText('看看附件')
  await expect(bubble.locator('.user-attachment')).toContainText('一个非常长的附件名字')
  await expect(bubble).not.toContainText('这段附件正文不应该出现在用户气泡里')
  await expect(bubble.locator('.user-attachment__name')).toHaveCSS('white-space', 'nowrap')
  expect(await bubble.evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(180)
  expect(mock.errors).toEqual([])
})

test('narrow settings keep controls readable and inside the screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '设置')
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: /工具管理/ }).click()
  await expect(page.getByRole('heading', { name: '工具管理', exact: true, level: 1 })).toBeVisible()
  const labels = page.locator('.settings-row__select .kima-select__trigger-label')
  await expect(labels.first()).toHaveText('每次询问')
  const clipped = await labels.evaluateAll(nodes => nodes.filter(node => {
    const range = document.createRange()
    range.selectNodeContents(node)
    return range.getBoundingClientRect().width > node.getBoundingClientRect().width + 0.1
  }).length)
  expect(clipped).toBe(0)

  // 高级页的多行输入也不能把设置卡片撑出 320px 屏幕。
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: /高级/ }).click()
  await expect(page.getByRole('heading', { name: '高级', exact: true, level: 1 })).toBeVisible()
  const overflow = await page.locator('.settings-scroll').evaluate(element => element.scrollWidth - element.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  expect(mock.errors).toEqual([])
})

test.describe('KIMA motion', () => {
  test.use({ reducedMotion: 'no-preference' })

  test('switch keeps a real thumb transition and moves when toggled', async ({ page }) => {
    await backend(page)
    await page.goto('/')
    await navigate(page, '设置')
    await page.getByRole('button', { name: /通用/ }).click()
    const toggle = page.getByRole('switch', { name: '增强键盘焦点' })
    const thumb = page.locator('.appearance-card .kima-switch', { hasText: '增强键盘焦点' }).locator('.kima-switch__thumb')
    await expect(toggle).not.toBeChecked()

    const duration = await thumb.evaluate(element => getComputedStyle(element).transitionDuration)
    expect(duration).not.toBe('0s')
    expect(duration).toMatch(/\d/)

    const before = await thumb.boundingBox()
    // KIMA 的透明 input 盖在拇指上，按拇指中心点真实点击一次。
    await page.mouse.click(before.x + before.width / 2, before.y + before.height / 2)
    await expect(toggle).toBeChecked()
    await expect.poll(async () => (await thumb.boundingBox()).x).not.toBeCloseTo(before.x, 1)
  })
})
