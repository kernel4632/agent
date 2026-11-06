/*
界面回归：使用受 OpenAPI 约束的模拟接口检查交互；真实联调由 ui-live.spec.js 负责。
和 ui-motion.spec.js 共用 chat-fixture.js 的接口 mock；动效断言在另一个文件。
运行：bun run test:ui
*/
import { expect, test } from '@playwright/test'
import { backend, navigate, openDrawer } from './chat-fixture.js'

async function openContextGroups(page) {
  const heads = page.locator('.context-group__head')
  const count = await heads.count()
  for (let index = 0; index < count; index += 1) {
    if (await heads.nth(index).getAttribute('aria-expanded') !== 'true') await heads.nth(index).click()
  }
}

async function screenshot(page, testInfo, name) {
  const layout = await page.evaluate(() => ['html', 'body', '.app-theme', '.rikka-app', '.rikka-main', '.app-main', '.app-drawer', '.topbar', '.chat-composer'].map(selector => {
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
  await expect(page.getByRole('combobox', { name: '搜索命令' })).toBeFocused()
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
  expect(mock.calls.some(call => /workspace|agent\/list|command\/list/.test(call.path))).toBe(false)
  expect(mock.errors).toEqual([])
})

test('mocked conversation: create, stream, rename, persistence, rollback and delete', async ({ page }, testInfo) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await expect(page.getByRole('button', { name: /模型与推理（当前 test-model/ })).toBeVisible()
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('一个新的项目')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.rikka-bubble--assistant .markdown-body')).toContainText('一步步实现')
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0)
  await screenshot(page, testInfo, 'chat')
  // 文件工作区面板已移除，原来的入口换成任务清单。
  await expect(page.getByRole('button', { name: '文件面板', exact: true })).toHaveCount(0)
  // 模型还没提出任务清单时，顶栏不显示清单按钮。
  await expect(page.getByRole('button', { name: '任务清单', exact: true })).toHaveCount(0)
  await page.locator('.rikka-bubble--user').first().click({ button: 'right' })
  // 右键直接进入聚光引导，卡片里选“回退”后原位切换成确认。
  await page.getByRole('button', { name: '回退到这条消息' }).click()
  await expect(page.getByRole('heading', { name: '回到这条消息之前？', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '确认回退', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toHaveValue('一个新的项目')
  await page.getByRole('button', { name: '撤销回退', exact: true }).click()
  await expect(page.locator('.rikka-bubble--assistant .markdown-body')).toContainText('一步步实现')
  await openDrawer(page)
  const created = page.locator('.home-session').filter({ hasText: '一个新的项目' })
  await created.hover()
  await created.getByRole('button', { name: /更多操作/ }).click()
  await screenshot(page, testInfo, 'session-menu')
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click()
  await page.getByRole('textbox', { name: '会话标题' }).fill('我的计划')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.reload()
  await openDrawer(page)
  const renamed = page.locator('.home-session').filter({ hasText: '我的计划' })
  await expect(renamed).toBeVisible()
  await renamed.hover()
  await renamed.getByRole('button', { name: /更多操作/ }).click()
  await page.getByRole('menuitem', { name: '删除', exact: true }).click()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.locator('.home-session')).toHaveCount(1)
  await renamed.hover()
  await renamed.getByRole('button', { name: /更多操作/ }).click()
  await page.getByRole('menuitem', { name: '删除', exact: true }).click()
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
  await page.getByRole('button', { name: /Test Provider/ }).click()
  await expect(page.getByRole('textbox', { name: '供应商名' })).toBeVisible()
  await screenshot(page, testInfo, 'settings-providers')
  await page.getByRole('textbox', { name: '供应商名' }).fill('Renamed provider')
  await page.getByRole('tab', { name: '模型', exact: true }).click()
  await screenshot(page, testInfo, 'settings-provider-models')
  await page.getByRole('button', { name: '添加模型', exact: true }).click()
  const modelForm = page.getByRole('dialog', { name: '添加模型', exact: true })
  await modelForm.getByRole('textbox', { name: '模型 ID', exact: true }).fill('another-model')
  await modelForm.getByRole('button', { name: '添加', exact: true }).click()
  await expect(modelForm).toBeHidden()
  await expect.poll(() => mock.config().providers[0].models.map(model => model.id)).toEqual(['test-model', 'another-model'])
  const saved = mock.config()
  expect(saved.prompt).toEqual({ system: 'Be helpful.', seeded: true })
  expect(saved.models.chat).toEqual({ provider: 'Renamed provider', model: 'test-model' })
  expect(saved.permission).toEqual({ '*': 'ask', execute_command: { '*': 'ask' } })
  expect(saved.mcp.sample.url).toBe('https://mcp.example.test')
  expect(saved.providers[0].headers).toEqual({ 'x-preserve': 'yes' })
  expect(saved.providers[0].models[0].context).toBe(64000)
  expect(saved.providers[0].body).toEqual({ temperature: 0.25 })
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('test-only-key')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await page.getByRole('button', { name: /通用/ }).click()
  await page.getByRole('radio', { name: '浅色', exact: true }).check()
  await expect(page.locator('.app-theme')).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await screenshot(page, testInfo, 'appearance-light')
  await page.getByRole('radio', { name: '深色', exact: true }).check()
  await expect(page.locator('.app-theme')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await screenshot(page, testInfo, 'appearance')
  const writes = mock.calls.filter(call => call.path === '/config/set').length
  await page.getByRole('switch', { name: '减少界面动画' }).check()
  await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', '')
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
  await expect(page.getByText('正在处理', { exact: true })).toBeVisible()
  await mock.emit('session-1', [{ type: 'agent-start' }, { type: 'permission', callID: 'call-1', tool: 'read', input: { path: 'example.txt' } }])
  await expect(page.getByText('等待你的许可')).toBeVisible()
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
  await expect(page.getByText('正在处理', { exact: true })).toBeVisible()

  await mock.emit('session-1', [
    { type: 'agent-start' },
    { type: 'tool-call', toolCallId: 'reason-1', toolName: 'read_file', input: { path: 'example.txt' } },
    { type: 'tool-result', toolCallId: 'reason-1', toolName: 'read_file', output: { type: 'text', value: 'ok' } },
    // 思考留在最后，后续增量才属于同一步；工具之后再思考会创建另一条步骤。
    { type: 'reasoning-delta', text: '先确认消息结构和工具调用顺序。'.repeat(40) },
  ])

  await expect(page.locator('.cot-card')).toBeVisible()
  await expect(page.locator('.cot-step--reasoning .reasoning-preview')).toHaveClass(/is-preview/)
  await expect(page.locator('.cot-step--tool')).toHaveCount(1)
  await screenshot(page, testInfo, 'reasoning-preview')

  // 流式期间也能真正收起：先展开全文，再点一次收起；后续增量不能把它重新打开。
  const head = page.locator('.cot-step--reasoning .cot-step__head')
  const content = page.locator('.cot-step--reasoning .cot-collapse')
  await head.click()
  await expect(head).toHaveAttribute('aria-expanded', 'true')
  await head.click()
  await expect(head).toHaveAttribute('aria-expanded', 'false')
  await expect(content).not.toHaveClass(/is-open/)
  await mock.emit('session-1', [{ type: 'reasoning-delta', text: '继续输出也不展开' }])
  await expect(page.locator('.reasoning-preview')).toContainText('继续输出也不展开')
  await expect(content).toHaveCount(1)
  await expect(content).not.toHaveClass(/is-open/)
  await head.click()
  await expect(content).toHaveClass(/is-open/)
})

test('reasoning content renders markdown', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('keep running')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByText('正在处理', { exact: true })).toBeVisible()

  await mock.emit('session-1', [
    { type: 'agent-start' },
    { type: 'reasoning-delta', text: '**先确认**消息结构，再读 `README`。\n\n- 看目录\n- 看工具' },
  ])

  const reasoning = page.locator('.cot-step--reasoning')
  await expect(reasoning.locator('.markdown-body strong')).toHaveText('先确认')
  await expect(reasoning.locator('.markdown-body code')).toHaveText('README')
  await expect(reasoning.locator('.markdown-body li')).toHaveCount(2)
  expect(mock.errors).toEqual([])
})

test('reasoning preview collapses after the llm finishes', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('keep running')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByText('正在处理', { exact: true })).toBeVisible()

  await mock.emit('session-1', [
    { type: 'agent-start' },
    { type: 'reasoning-delta', text: '先确认消息结构和工具调用顺序。'.repeat(40) },
    { type: 'tool-call', toolCallId: 'reason-1', toolName: 'read_file', input: { path: 'example.txt' } },
    { type: 'tool-result', toolCallId: 'reason-1', toolName: 'read_file', output: { type: 'text', value: 'ok' } },
    { type: 'llm-finish', text: '查完了。', usage: { input: 10, output: 4, total: 14 } },
  ])

  // 这一轮结束后一级树会收起；先展开一级，才检查里面思考步骤自己的折叠状态。
  await expect(page.locator('.cot-step--reasoning .reasoning-preview')).not.toHaveClass(/is-preview/)
  await expect(page.locator('.cot-step--reasoning .cot-collapse')).not.toHaveClass(/is-open/)
  await expect(page.locator('.cot-step--tool')).toHaveCount(1)
})

test('tool row keeps declared metadata and shows generic input and output', async ({ page }, testInfo) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('keep running')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByText('正在处理', { exact: true })).toBeVisible()

  await mock.emit('session-1', [
    { type: 'agent-start' },
    { type: 'tool-call', toolCallId: 'todo-1', toolName: 'update_todo_list', input: { todos: '- [x] 读现有实现\n- [-] 改 session 指令\n- [ ] 补测试' } },
    { type: 'tool-result', toolCallId: 'todo-1', toolName: 'update_todo_list', output: { type: 'json', value: { items: [
      { text: '读现有实现', status: 'completed' },
      { text: '改 session 指令', status: 'in_progress' },
      { text: '补测试', status: 'pending' },
    ] } } },
  ])

  const label = page.locator('.cot-step--tool .cot-step__label')
  await expect(label).toHaveText('任务清单')
  await expect(page.locator('.cot-step--tool .cot-step__summary')).toHaveText('当前进度')
  await expect(page.locator('.cot-step--tool .cot-step__body')).toBeVisible()
  await expect(page.locator('.cot-step--tool .cot-step__extra')).toContainText('已更新')
  await expect(page.locator('.cot-step--tool .tool-result')).toContainText('补测试')
  await expect(page.locator('.cot-step--tool .tool-result')).toContainText('status')
  await expect(page.locator('.cot-step--tool .tool-result')).toContainText('pending')
  await page.locator('.cot-step--tool').getByRole('button', { name: /查看输入参数/ }).click()
  await expect(page.locator('.cot-step--tool .tool-input')).toContainText('读现有实现')
  // 清单入口保留在顶栏，用量统计只显示在输入框下方。
  await expect(page.locator('.session-todos')).toHaveCount(0)
  const todoButton = page.getByRole('button', { name: '任务清单', exact: true })
  await expect(todoButton).toBeVisible()
  const statsBox = await page.locator('.session-composer__stats').boundingBox()
  const composerBox = await page.locator('.chat-composer').boundingBox()
  expect(statsBox.y).toBeGreaterThanOrEqual(composerBox.y + composerBox.height - 1)
  await todoButton.click()
  const panel = page.getByRole('dialog', { name: '任务清单' })
  await expect(panel).toBeVisible()
  await expect(panel.getByText('读现有实现', { exact: true })).toBeVisible()
  await expect(panel.getByText('1 / 3')).toBeVisible()
  await expect(panel.locator('.session-todo-panel__status')).toHaveText(['已完成', '进行中', '待处理'])
  await screenshot(page, testInfo, 'tool-todo')
  await panel.getByRole('button', { name: '关闭' }).click()
  expect(mock.errors).toEqual([])
})

test('core compact deltas stay outside the answer and stop partial', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('keep running')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByText('正在处理', { exact: true })).toBeVisible()
  await mock.emit('session-1', [
    { type: 'agent-resume' },
    { type: 'compact-start', messages: [] },
    { type: 'text-delta', request: 'compact', text: '仅供内部使用的压缩摘要' },
    { type: 'reasoning-delta', request: 'compact', text: '仅供内部使用的摘要思考' },
    { type: 'compact-finish', content: '仅供内部使用的压缩摘要', usage: { inputTokens: 7, outputTokens: 2, totalTokens: 9 } },
    { type: 'llm-start' },
    { type: 'text-delta', text: '保留的用户回答' },
  ])
  await expect(page.locator('.rikka-bubble--assistant')).toContainText('保留的用户回答')
  // 压缩摘要现在单独显示在时间线的压缩行里，不能混进正常回答或停止时交给后端的 partial。
  await expect(page.locator('.compact-stream')).toContainText('仅供内部使用的压缩摘要')
  await expect(page.locator('.rikka-bubble--assistant .markdown-body')).not.toContainText('仅供内部使用')
  await page.getByRole('button', { name: '停止生成', exact: true }).click()
  await expect.poll(() => mock.calls.filter(call => call.path === '/agent/stop/session-1').length).toBe(1)
  const stopped = mock.calls.find(call => call.path === '/agent/stop/session-1')
  expect(stopped.body.partial.content).toContain('保留的用户回答')
  expect(JSON.stringify(stopped.body.partial)).not.toContain('仅供内部使用')
  expect(mock.errors).toEqual([])
})

test('auto-continued assistant keeps non-stop text in the timeline and finish result as the reply', async ({ page }, testInfo) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('keep running')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByText('正在处理', { exact: true })).toBeVisible()

  await mock.emit('session-1', [
    { type: 'agent-start' },
    { type: 'text-delta', text: '第一段。' },
    { type: 'llm-finish', text: '第一段。', usage: { input: 10, output: 4, total: 14 } },
    { type: 'tool-call', toolCallId: 'todo-1', toolName: 'update_todo_list', input: { todos: '- [ ] 继续' } },
    { type: 'tool-result', toolCallId: 'todo-1', toolName: 'update_todo_list', output: { type: 'json', value: { items: [{ text: '继续', status: 'pending' }] } } },
    { type: 'text-delta', text: '第二段。' },
    { type: 'llm-finish', text: '第二段。', usage: { input: 12, output: 5, total: 17 } },
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
  await openContextGroups(page)
  if (await card.locator('.cot-more').count()) await card.locator('.cot-more').click()
  await expect(card).toContainText('第一段。')
  await expect(card).toContainText('第二段。')
  // 步骤全部展开，不再只留最后两步。
  await expect(card.locator('.cot-step')).toHaveCount(3)
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

test('assistant markdown uses local code blocks and typography', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('keep running')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  // 先等默认开场事件被处理，再注入本例内容，避免两批回复互相覆盖。
  await expect(page.getByText('正在处理', { exact: true })).toBeVisible()

  await mock.emit('session-1', [
    { type: 'agent-start' },
    { type: 'text-delta', text: '\n\n# 示例标题\n\n这是一个 **加粗** 段落。\n\n```js\nconst answer = 42\nconsole.log(answer)\n```' },
  ])

  const bubble = page.locator('.rikka-bubble--assistant')
  await expect(bubble.locator('.ui-typography--heading')).toContainText('示例标题')
  await expect(bubble).toContainText('加粗')
  await expect(bubble.locator('.ui-code-block')).toContainText('const answer = 42', { timeout: 10000 })
  await expect(bubble.locator('.ui-code-block').getByRole('button', { name: '复制代码' })).toBeVisible()
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

test('reconnecting covers the composer with a status overlay', async ({ page }) => {
  const mock = await backend(page)
  await page.route('**/sse/connect/**', route => route.abort())
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('keep running')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()

  const overlay = page.locator('.reconnect-overlay')
  await expect(overlay).toBeVisible()
  await expect(overlay).toContainText('正在重新连接')
  const overlayBox = await overlay.boundingBox()
  const composerBox = await page.locator('.chat-composer').boundingBox()
  expect(Math.abs(overlayBox.y - composerBox.y)).toBeLessThan(2)
  expect(Math.abs(overlayBox.height - composerBox.height)).toBeLessThan(2)
  // 覆盖层只挡输入区，对话内容仍可见。
  await expect(page.locator('.reconnect-overlay .ui-spinner')).toBeVisible()
  await expect(page.locator('.chat-composer')).toHaveAttribute('inert', '')
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
  await expect(page.getByText('正在处理', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '停止生成', exact: true }).click()
  await expect(page.getByRole('button', { name: '继续助手', exact: true })).toBeVisible()
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
  await expect.poll(() => mock.calls.some(call => call.path === '/agent/stop/session-1')).toBe(true)
  const stopCall = mock.calls.find(call => call.path === '/agent/stop/session-1')
  expect(stopCall.body.partial).toMatchObject({ content: '正在处理' })
  await expect(page.getByText('正在处理', { exact: true })).toBeVisible()
  const continueButton = page.getByRole('button', { name: '继续助手', exact: true })
  await expect(continueButton).toBeVisible()
  await continueButton.click()
  await expect.poll(() => mock.calls.some(call => call.path === '/agent/resume/session-1')).toBe(true)
  expect(mock.errors).toEqual([])
})

test('typing after an interruption sends a new message instead of resuming', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('keep running')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByText('正在处理', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '停止生成', exact: true }).click()
  await expect(page.getByRole('button', { name: '继续助手', exact: true })).toBeVisible()

  // 输入框有字时，发送按钮优先：先把用户消息接在被打断的记录后面。
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('补充一句')
  const send = page.getByRole('button', { name: '发送消息', exact: true })
  await expect(send).toBeVisible()
  await send.click()
  await expect.poll(() => mock.calls.some(call => call.path === '/agent/send/session-1' && call.body?.input?.includes('补充一句'))).toBe(true)
  expect(mock.calls.some(call => call.path === '/agent/resume/session-1')).toBe(false)
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
  const connections = mock.calls.filter(call => call.path === '/sse/connect/session-1').length
  await page.reload()
  await openDrawer(page)
  await page.locator('.home-session__main').filter({ hasText: '新对话' }).click()
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible()
  await expect.poll(() => mock.calls.filter(call => call.path === '/sse/connect/session-1').length).toBeGreaterThan(connections)

  await mock.emit('session-1', [{ type: 'retry', attempt: 1, delay: 5000 }])
  await expect(page.getByText(/模型请求失败，第 1 次自动重试，5s 后继续/).first()).toBeVisible()
  await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '停止生成', exact: true }).click()
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeVisible()
  expect(mock.errors).toEqual([])
})

test('connection failure is visible and does not replace the page with a blank screen', async ({ page }) => {
  await page.route('**/api/config/read', route => route.fulfill({ status: 503, body: 'Unavailable' }))
  await page.goto('/')
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('无法连接后端')
  const overlay = page.locator('.connection-overlay')
  await expect(overlay).toHaveCSS('backdrop-filter', /blur/)
  const overlayBox = await overlay.boundingBox()
  const composerBox = await page.locator('.chat-composer').boundingBox()
  // 只覆盖输入框，不盖住整个聊天面板。
  expect(Math.abs(overlayBox.y - composerBox.y)).toBeLessThan(2)
  expect(Math.abs(overlayBox.height - composerBox.height)).toBeLessThan(2)
  expect(Math.abs(overlayBox.width - composerBox.width)).toBeLessThan(2)
  await expect(page.locator('.chat-composer')).toHaveAttribute('inert', '')
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
  await page.getByRole('button', { name: /上下文/ }).click()
  await page.getByLabel('阈值', { exact: true }).fill('0.6')
  await page.getByLabel('阈值', { exact: true }).press('Tab')
  await expect.poll(() => mock.config().compact.threshold).toBe(0.6)
  await page.waitForTimeout(200)
  await page.keyboard.press('Escape')
  await expect(page.locator('.settings-screen')).toHaveCount(0)
  await expect(editor).toHaveValue('尚未发送的草稿')

  await navigate(page, '设置')
  await page.getByRole('button', { name: /模型供应商/ }).click()
  await page.locator('.provider-row').first().click()
  await page.getByRole('textbox', { name: '供应商名' }).fill('')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.locator('.settings-screen:not([inert])')).toBeVisible()
  await expect(page.getByRole('status')).toContainText('供应商名称不能为空或重复')
  await page.getByRole('button', { name: /模型供应商/ }).click()
  await page.locator('.provider-row').first().click()
  await page.getByRole('textbox', { name: '供应商名' }).fill('Test Provider')
  await expect.poll(() => mock.config().providers[0].name).toBe('Test Provider')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(editor).toHaveValue('尚未发送的草稿')
  expect(mock.errors).toEqual([])
})

test('slash-prefixed messages are sent as ordinary text', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  const editor = page.getByRole('textbox', { name: '消息', exact: true })
  await editor.fill('/review focus')
  await expect(page.getByRole('listbox', { name: '斜杠命令' })).toHaveCount(0)
  await editor.press('Enter')
  await expect.poll(() => mock.calls.filter(call => call.path.startsWith('/agent/send/')).at(-1)?.body?.input)
    .toBe('/review focus')
})

test('provider tabs test the connection and edit model metadata', async ({ page }, testInfo) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '设置')
  await page.getByRole('button', { name: /模型供应商/ }).click()
  await page.getByRole('button', { name: /Test Provider/ }).click()

  await page.getByRole('button', { name: '测试连接', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('连接成功')

  await page.getByRole('tab', { name: '高级设置', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '自定义请求头' })).toHaveValue(/"x-preserve"/)
  await screenshot(page, testInfo, 'settings-provider-advanced')

  await page.getByRole('tab', { name: '模型', exact: true }).click()
  await page.getByRole('button', { name: '编辑模型', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '编辑模型' })).toBeVisible()
  await page.getByRole('spinbutton', { name: '上下文窗口' }).fill('32000')
  await page.getByRole('button', { name: '保存模型', exact: true }).click()
  await expect.poll(() => mock.config().providers[0].models[0].context).toBe(32000)

  const saved = mock.config()
  expect(saved.providers[0].headers).toEqual({ 'x-preserve': 'yes' })
  expect(saved.providers[0].models).toEqual([{ id: 'test-model', name: 'test-model', context: 32000, capabilities: ['text', 'tools'] }])
  expect(mock.errors).toEqual([])
})

test('reasoning picker saves the selected level', async ({ page }, testInfo) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('你好')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.rikka-bubble--assistant .markdown-body')).toContainText('一步步实现')

  const button = page.getByRole('button', { name: /模型与推理（当前 test-model/ })
  await expect(button).toBeVisible()
  await button.click()
  const reasoningRow = page.getByRole('menuitem', { name: /推理强度/ })
  if (testInfo.project.name === 'desktop') await reasoningRow.hover()
  else await reasoningRow.click()
  const levels = page.getByRole('menu', { name: '推理强度' })
  await expect(levels).toBeVisible()
  await screenshot(page, testInfo, 'reasoning-menu')
  await levels.getByRole('menuitemradio', { name: '重', exact: true }).click()

  await expect.poll(() => mock.calls.findLast(call => call.path === '/session/settings/session-1' && call.body?.reasoning)?.body.reasoning).toBe('high')
  await expect(button).toHaveAccessibleName(/思考强度：重/)
  expect(mock.errors).toEqual([])
})

test('context groups summarize tools and keep text between groups', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('keep running')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByText('正在处理', { exact: true })).toBeVisible()

  await mock.emit('session-1', [
    { type: 'agent-start' },
    { type: 'reasoning-delta', text: '先查一下。' },
    { type: 'tool-call', toolCallId: 'flow-a', toolName: 'read_file', input: { path: 'a.txt' } },
    { type: 'tool-result', toolCallId: 'flow-a', toolName: 'read_file', output: { type: 'text', value: 'a' } },
    { type: 'text-delta', text: '中间说一句。' },
    { type: 'tool-call', toolCallId: 'flow-b', toolName: 'execute_command', input: { command: 'bun test' } },
    { type: 'tool-result', toolCallId: 'flow-b', toolName: 'execute_command', output: { type: 'text', value: 'ok' } },
  ])

  await expect(page.locator('.request-status')).toHaveCount(0)
  const groups = page.locator('.context-group__head')
  await expect(groups).toHaveCount(2)
  await expect(groups.first()).toContainText('读取文件 1 次')
  await expect(groups.nth(1)).toContainText('执行命令 1 次')
  await expect(groups.first()).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('.process-fold__head')).toContainText('使用了 2 次工具')
  await openContextGroups(page)
  await expect(page.locator('.cot-step--tool')).toHaveCount(2)
  expect(mock.errors).toEqual([])
})
test('process fold summarizes work, toggles steps, and stays transparent', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('keep running')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await page.getByText('正在处理', { exact: true }).waitFor()
  await mock.emit('session-1', [
    { type: 'agent-start' },
    { type: 'reasoning-delta', text: '先想一下。' },
    { type: 'tool-call', toolCallId: 'fold-1', toolName: 'read_file', input: { path: 'a.txt' } },
    { type: 'tool-result', toolCallId: 'fold-1', toolName: 'read_file', output: { type: 'text', value: 'ok' } },
  ])

  const head = page.locator('.process-fold__head')
  await expect(head).toContainText('处理过程')
  await expect(head).toContainText('1 次思考')
  await expect(head).toContainText('使用了 1 次工具')
  await expect(head).toContainText('读取文件 1 次')
  expect(await page.locator('.process-fold__body').evaluate(element => getComputedStyle(element).transitionProperty)).toContain('grid-template-rows')
  await page.mouse.move(0, 0)
  expect(await head.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)')

  await head.click()
  await expect(page.locator('.process-fold__body')).toHaveAttribute('aria-hidden', 'true')
  await head.click()
  await expect(page.locator('.process-fold__body')).toHaveAttribute('aria-hidden', 'false')
})

test('completed steps collapse individually, not the whole process', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('keep running')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByText('正在处理', { exact: true })).toBeVisible()

  await mock.emit('session-1', [
    { type: 'agent-start' },
    ...['a', 'b', 'c', 'd'].flatMap((id, index) => [
      { type: 'llm-start' },
      { type: 'llm-finish', text: '', usage: { input: 10 + index, output: 1, total: 11 + index } },
      { type: 'tool-call', toolCallId: `tool-${id}`, toolName: 'read_file', input: { path: `${id}.txt` } },
      { type: 'tool-result', toolCallId: `tool-${id}`, toolName: 'read_file', output: { type: 'text', value: 'ok' } },
    ]),
    { type: 'agent-finish', reason: 'completed' },
  ])

  // 工具组完成后收起，组内工具也各自收起；展开组后再点开单条工具。
  await expect(page.locator('.context-group__head')).toHaveCount(1)
  await expect(page.locator('.context-group__head')).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('.context-group__head')).toContainText('使用了 4 次工具：读取文件 4 次')
  await openContextGroups(page)
  await expect(page.locator('.cot-step--tool')).toHaveCount(4)
  await expect(page.locator('.cot-step--tool .cot-step__body')).toHaveCount(0)
  await page.locator('.cot-step--tool .cot-step__head').first().click()
  await expect(page.locator('.cot-step--tool .cot-step__body')).toHaveCount(1)
  expect(mock.errors).toEqual([])
})

test('compaction shows a status row before the next model request', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('keep running')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByText('正在处理', { exact: true })).toBeVisible()

  await mock.emit('session-1', [
    { type: 'agent-start' },
    { type: 'compact-start', messages: 40, startedAt: Date.now() - 3000 },
    { type: 'text-delta', text: '正在总结前面的对话', request: 'compact' },
  ])
  const compact = page.locator('.request-status').last()
  await expect(compact).toContainText('正在压缩上下文…')
  await expect(compact).toContainText('正在把前面的对话总结成一段')
  await expect(page.locator('.compact-stream')).toContainText('正在总结前面的对话')
  await expect(page.locator('.cot-card')).toBeVisible()

  await mock.emit('session-1', [
    { type: 'compact-finish', content: '摘要', usage: { input: 100, output: 20, total: 120 }, durationMs: 3000 },
    { type: 'llm-start', startedAt: Date.now() },
    { type: 'text-delta', text: '继续处理' },
  ])
  // 普通模型请求不再单独占一行；压缩状态仍保留。
  await expect(page.locator('.request-status')).toHaveCount(1)
  const rows = page.locator('.request-status')
  await expect(rows.first()).toContainText('上下文压缩完成')
  await expect(rows.first()).toContainText(/入\s*100/)
  await expect(page.locator('.compact-stream')).toContainText('摘要')
  await expect(page.locator('.cot-step--text')).toContainText('继续处理')
  expect(mock.errors).toEqual([])
})

test('tool arguments stream into the timeline before the tool call', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('keep running')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByText('正在处理', { exact: true })).toBeVisible()

  await mock.emit('session-1', [
    { type: 'agent-start' },
    { type: 'llm-start', startedAt: Date.now() - 2000 },
    { type: 'tool-input-start', id: 'call-stream', toolName: 'write_file' },
    { type: 'tool-input-delta', id: 'call-stream', delta: '{"path": "a.txt",' },
    { type: 'tool-input-delta', id: 'call-stream', delta: ' "content": "hello"}' },
  ])

  const tool = page.locator('.cot-step--tool')
  await expect(tool).toHaveCount(1)
  await expect(tool.locator('.cot-step__extra')).toContainText('正在生成参数')
  await expect(tool.locator('.tool-input.is-streaming')).toContainText('"path": "a.txt"')

  await mock.emit('session-1', [{ type: 'tool-call', toolCallId: 'call-stream', toolName: 'write_file', input: { path: 'a.txt', content: 'hello' } }])
  await expect(tool.locator('.cot-step__extra')).toContainText('正在执行')
  await expect(tool.locator('.tool-input')).toHaveCount(0)
  await tool.getByRole('button', { name: /查看输入参数/ }).click()
  await expect(tool.locator('.tool-input')).toContainText('path')
  await expect(tool.locator('.tool-input')).toContainText('a.txt')
  expect(mock.errors).toEqual([])
})

test('tool input renders multiline strings and markdown code blocks', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('keep running')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByText('正在处理', { exact: true })).toBeVisible()

  await mock.emit('session-1', [{
    type: 'tool-call',
    toolCallId: 'markdown-input',
    toolName: 'write_file',
    input: { path: 'README.md', content: '# 标题\n\n普通行\n\n```js\nconst answer = 42\n```\n' },
  }])

  const tool = page.locator('.cot-step--tool')
  const inputSection = tool.locator('.tool-content--input')
  const outputSection = tool.locator('.tool-content--output')
  await expect(inputSection).toBeVisible()
  const inputBox = await inputSection.boundingBox()
  const outputBox = await outputSection.boundingBox()
  expect(inputBox.y).toBeLessThan(outputBox.y)
  await expect(tool.locator('.tool-input')).toHaveCount(0)
  await expect(tool.getByRole('button', { name: /查看输入参数/ })).toBeVisible()
  await tool.getByRole('button', { name: /查看输入参数/ }).click()
  await expect(tool.locator('.tool-input .markdown-body h1')).toHaveText('标题')
  await expect(tool.locator('.tool-input .ui-code-block')).toContainText('const answer = 42')
  await expect(tool.locator('.tool-input')).not.toContainText('\\n')

  await tool.getByRole('button', { name: '原始', exact: true }).click()
  await expect(tool.locator('.tool-input')).toContainText('\\n')
  await tool.getByRole('button', { name: '渲染', exact: true }).click()
  await expect(tool.locator('.tool-input .ui-code-block')).toBeVisible()
  await expect(tool.locator('.tool-actions')).toHaveCount(0)
  expect(mock.errors).toEqual([])
})

test('composer footer stats opens the session data panel', async ({ page }, testInfo) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('你好')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.rikka-bubble--assistant .markdown-body')).toContainText('一步步实现')

  const stats = page.locator('.session-composer__stats')
  await expect(stats).toBeVisible()
  await expect(page.locator('.topbar .session-stats')).toHaveCount(0)
  await expect(stats).toContainText('50 tokens')
  await expect(stats).toContainText('缓存命中 33.3%')
  await expect(stats).not.toContainText('轮')
  await expect(stats).toContainText('33 tok/s')
  await expect(stats).not.toContainText('消息')
  const composerBox = await page.locator('.chat-composer').boundingBox()
  const statsBox = await stats.boundingBox()
  expect(statsBox.y).toBeGreaterThanOrEqual(composerBox.y + composerBox.height - 1)
  await expect(page.locator('.topbar__subtitle')).toHaveCount(0)
  // 宽屏下输入卡片和对话流居中，不再贴着左侧。
  if (testInfo.project.name === 'desktop') {
    const panel = await page.locator('.session-panel').boundingBox()
    const card = await page.locator('.chat-composer').boundingBox()
    const left = card.x - panel.x
    const right = panel.x + panel.width - card.x - card.width
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1.5)
  }
  await screenshot(page, testInfo, 'composer-footer-stats')

  await stats.getByRole('button', { name: /上下文占用/ }).click()
  const contextPanel = page.getByRole('dialog', { name: '上下文统计' })
  await expect(contextPanel.locator('.stats-panel__contextbar-used')).toBeVisible()
  await expect(contextPanel.locator('.stats-panel__contextbar')).toHaveCSS('height', '7px')
  await expect(contextPanel).toContainText('自动压缩 80%')
  await page.keyboard.press('Escape')

  await stats.getByRole('button', { name: /tokens/ }).click()
  const usage = page.getByRole('dialog', { name: 'Token 用量' })
  await expect(usage).toContainText('50')
  await expect(usage).toContainText('30')
  await expect(usage).toContainText('20')
  await expect(usage).toContainText('33%')
  await expect(usage.locator('.stats-panel__stack .is-user')).toHaveCount(1)
  await screenshot(page, testInfo, 'composer-footer-stats-panel')

  await stats.getByRole('button', { name: /33 tok\/s/ }).click()
  const speedPanel = page.getByRole('dialog', { name: '生成速度' })
  await expect(speedPanel).toContainText('test-model')
  await expect(speedPanel).toContainText('Test Provider')
  await expect(speedPanel).toContainText('200ms')
  await expect(speedPanel).toContainText('800ms')
  await expect(speedPanel).toContainText('25')
  expect(mock.errors).toEqual([])
})

test('legacy history without usage shows estimated stats, not zeros', async ({ page }, testInfo) => {  const mock = await backend(page)
  // 旧会话没有保存每次请求的 usage；统计必须从消息内容估算并标出来。
  mock.sessions.set('legacy-1', {
    id: 'legacy-1',
    title: '旧会话',
    provider: 'Test Provider',
    model: 'test-model',
    history: [
      { messageId: 'legacy-u1', role: 'user', content: '帮我看一下这个项目，然后告诉我从哪里开始改。' },
      { messageId: 'legacy-a1', role: 'assistant', content: [{ type: 'text', text: '我先读几个文件，再给你一个具体的起点。' }] },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    settings: { reasoning: 'auto' },
    todos: [],
    running: false,
    pending: [],
    undoable: 0,
  })
  await page.goto('/')
  await openDrawer(page)
  await page.getByRole('button', { name: '旧会话', exact: true }).click()
  await expect(page.locator('.topbar h1')).toHaveText('旧会话')

  const ring = page.locator('.session-composer__stats').getByRole('button', { name: /上下文占用/ })
  await expect(ring).toBeVisible()
  await expect(ring).toContainText('~')
  await ring.click()
  const contextPanel = page.getByRole('dialog', { name: '上下文统计' })
  await expect(contextPanel.getByText('估算', { exact: true })).toBeVisible()
  await expect(contextPanel.locator('.stats-panel__contextbar-used')).toBeVisible()
  await page.keyboard.press('Escape')

  await page.locator('.session-composer__stats').getByRole('button', { name: /tokens/ }).click()
  const panel = page.getByRole('dialog', { name: 'Token 用量' })
  await expect(panel.getByText('估算', { exact: true })).toBeVisible()
  await expect(panel.locator('.stats-panel__overview-value strong')).not.toHaveText('0')
  await screenshot(page, testInfo, 'topbar-stats-estimated')
  expect(mock.errors).toEqual([])
})

test('compaction summary renders as a divider, not a user bubble', async ({ page }, testInfo) => {
  const mock = await backend(page)
  mock.sessions.set('compact-1', {
    id: 'compact-1',
    title: '压缩过的会话',
    provider: 'Test Provider',
    model: 'test-model',
    history: [
      { messageId: 'compact-u1', role: 'user', content: '旧问题' },
      { messageId: 'compact-a1', role: 'assistant', content: [{ type: 'text', text: '旧回答' }] },
      { messageId: 'compact-summary', role: 'user', compact: true, content: '压缩摘要正文' },
      { messageId: 'compact-u2', role: 'user', content: '新问题' },
      { messageId: 'compact-a2', role: 'assistant', content: [{ type: 'text', text: '新回答' }] },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    settings: { reasoning: 'auto' },
    todos: [],
    running: false,
    pending: [],
    undoable: 0,
  })
  await page.goto('/')
  await openDrawer(page)
  await page.getByRole('button', { name: '压缩过的会话', exact: true }).click()
  await expect(page.locator('.compaction-notice')).toBeVisible()
  await expect(page.locator('.compaction-notice')).toContainText('上下文已压缩')
  await expect(page.locator('.rikka-bubble--user').filter({ hasText: '压缩摘要正文' })).toHaveCount(0)
  await page.locator('.compaction-notice__button').click()
  await expect(page.locator('.compaction-summary')).toContainText('压缩摘要正文')
  await screenshot(page, testInfo, 'compaction-divider')
  expect(mock.errors).toEqual([])
})

test('existing conversation switches model from the input bar', async ({ page }, testInfo) => {
  const mock = await backend(page)
  mock.config().providers[0].models.push(...['another-model', 'gpt-4.1'].map(id => ({ id, name: id, context: 128000, capabilities: ['text', 'tools'] })))
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('你好')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.rikka-bubble--assistant .markdown-body')).toContainText('一步步实现')
  await page.getByRole('button', { name: /模型与推理（当前 test-model/ }).click()
  const modelRow = page.getByRole('menuitem', { name: /切换模型/ })
  if (testInfo.project.name === 'desktop') await modelRow.hover()
  else await modelRow.click()
  const models = page.getByRole('menu', { name: '选择模型' })
  await expect(models).toBeVisible()
  // 所有模型使用同一个装饰图标，名称和选择行为仍然可访问。
  const named = models.getByRole('menuitemradio', { name: 'gpt-4.1', exact: true }).locator('.composer-menu__option-icon svg')
  const generic = models.getByRole('menuitemradio', { name: 'another-model', exact: true }).locator('.composer-menu__option-icon svg')
  await expect(named).toBeVisible()
  await expect(generic).toBeVisible()
  expect(await named.innerHTML()).toBe(await generic.innerHTML())
  await screenshot(page, testInfo, 'model-menu')
  await models.getByRole('menuitemradio', { name: 'another-model', exact: true }).click()
  await expect.poll(() => mock.calls.find(call => call.path === '/session/model/session-1')?.body)
    .toEqual({ provider: 'Test Provider', model: 'another-model' })
  await expect(page.getByRole('button', { name: /模型与推理（当前 another-model/ })).toBeVisible()
})

test('system prompt can be edited and intentionally cleared', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '设置')
  await expect(page.getByRole('button', { name: /^智能体/ })).toHaveCount(0)
  await page.getByRole('button', { name: /系统提示词/ }).click()
  await page.getByLabel('系统提示词', { exact: true }).fill('用中文回答。')
  await expect.poll(() => mock.config().prompt.system).toBe('用中文回答。')
  await page.getByLabel('系统提示词', { exact: true }).fill('')
  await expect.poll(() => mock.config().prompt.system).toBe('')
  expect(mock.config().prompt.seeded).toBe(true)
  expect(mock.errors).toEqual([])
})

test('tool permissions save and MCP settings remain available', async ({ page }, testInfo) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '设置')

  await page.getByRole('button', { name: /工具管理/ }).click()
  await expect(page.getByText('读取文件', { exact: true })).toBeVisible()
  await expect(page.getByText('执行命令', { exact: true })).toBeVisible()
  // 只有开关：没有禁止调用，也没有进入二级权限页的入口。
  await expect(page.getByRole('radio')).toHaveCount(0)
  await expect(page.getByText('禁止调用')).toHaveCount(0)
  await screenshot(page, testInfo, 'settings-tools')

  const readSwitch = page.getByRole('switch', { name: '读取文件 自动执行' })
  const commandSwitch = page.getByRole('switch', { name: '执行命令 自动执行' })
  await expect(readSwitch).not.toBeChecked()
  await readSwitch.check()
  await expect.poll(() => mock.config().permission.read_file).toBe('allow')
  await commandSwitch.check()
  await expect.poll(() => mock.config().permission.execute_command).toEqual({ '*': 'allow' })
  await readSwitch.uncheck()
  await expect.poll(() => mock.config().permission.read_file).toBe('ask')

  await page.getByRole('button', { name: '返回', exact: true }).click()
  await page.getByRole('button', { name: /MCP 服务/ }).click()
  await expect(page.getByRole('button', { name: /^sample/ })).toBeVisible()
  await screenshot(page, testInfo, 'settings-mcp')

  expect(mock.errors).toEqual([])
})

test('message action forks the conversation at that message', async ({ page }, testInfo) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('你好')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.rikka-bubble--assistant .markdown-body')).toContainText('一步步实现')
  await page.locator('.rikka-bubble--user').first().click({ button: 'right' })
  // 右键不再打开居中大菜单：直接进入聚光引导，卡片里只有操作按钮。
  await expect(page.getByRole('dialog', { name: '消息操作', exact: true })).toBeVisible()
  const actions = page.locator('.rollback-spotlight__card')
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
  await expect(page.getByRole('heading', { name: 'MCP 2', level: 3 })).toBeVisible()
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

test('MCP servers detected on this machine can be imported and tested', async ({ page }, testInfo) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '设置')
  await page.getByRole('button', { name: /MCP 服务/ }).click()

  // 打开 MCP 页就会扫本机；识别结果只展示，点添加才写入本应用配置。
  await expect(page.getByRole('heading', { name: '本机识别到的服务' })).toBeVisible()
  await expect(page.getByText('Cursor · npx -y server-github')).toBeVisible()
  await screenshot(page, testInfo, 'settings-mcp-detected')

  await page.getByRole('button', { name: '添加', exact: true }).click()
  await expect.poll(() => mock.config().mcp.github?.command).toBe('npx')
  await expect(page.getByText('已添加')).toBeVisible()

  // 进编辑页测试已保存的服务，结果直接显示在表单里。
  await page.getByRole('button', { name: /^github/ }).click()
  await expect(page.getByRole('heading', { name: 'github', level: 3 })).toBeVisible()
  await page.getByRole('button', { name: '测试连接' }).click()
  await expect(page.getByRole('status')).toContainText('连接成功，1 个工具：echo')
})

test('skills can be listed, created and toggled', async ({ page }, testInfo) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '设置')
  await page.getByRole('button', { name: /技能/ }).click()
  await expect(page.getByRole('heading', { name: '技能', exact: true, level: 1 })).toBeVisible()
  await expect(page.getByText('review', { exact: true })).toBeVisible()
  await screenshot(page, testInfo, 'settings-skills')

  // 新建技能后回到列表，服务端收到的字段和界面输入一致。
  await page.getByRole('button', { name: /新建技能/ }).click()
  await page.getByLabel('技能名称').fill('check-docs')
  await page.getByLabel('什么时候用').fill('检查文档时用')
  await page.getByLabel('正文（Markdown）').fill('先读目录')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('check-docs', { exact: true })).toBeVisible()
  expect(mock.calls.some(call => call.path === '/skill/save' && call.body?.name === 'check-docs')).toBe(true)

  // 关闭只是从模型清单里拿掉，技能仍然显示在管理列表里。
  await page.getByRole('switch', { name: 'review 交给模型' }).click()
  await expect.poll(() => mock.calls.findLast(call => call.path === '/skill/toggle')?.body?.enabled).toBe(false)
  await expect(page.getByText('已关闭')).toBeVisible()

  // 外部目录先识别、再手动启用。
  await page.getByRole('switch', { name: '启用 Claude Code' }).click()
  await expect.poll(() => mock.calls.findLast(call => call.path === '/skill/source')?.body?.enabled).toBe(true)
})

test('task models save globally and clearing restores shared model', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '设置')
  await page.locator('.settings-row').filter({ hasText: '默认模型和任务分工' }).click()
  await expect(page.getByRole('heading', { name: '模型', exact: true, level: 1 })).toBeVisible()
  await expect(page.getByRole('combobox', { name: '默认模型' })).toContainText('Test Provider / test-model')

  const compact = page.getByRole('combobox', { name: '压缩上下文', exact: true })
  await compact.click()
  await page.getByRole('option', { name: 'Test Provider / test-model', exact: true }).click()
  await expect.poll(() => mock.config().models.compact).toEqual({ provider: 'Test Provider', model: 'test-model' })
  await compact.click()
  await page.getByRole('option', { name: '和默认模型共用', exact: true }).click()
  await expect.poll(() => mock.config().models.compact).toEqual({ provider: '', model: '' })
  expect(mock.config().models.chat).toEqual({ provider: 'Test Provider', model: 'test-model' })
})

test('compaction threshold is saved in context settings', async ({ page }, testInfo) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '设置')
  await page.getByRole('button', { name: /上下文/ }).click()
  await expect(page.getByRole('heading', { name: '上下文', exact: true, level: 1 })).toBeVisible()
  await screenshot(page, testInfo, 'settings-context')
  const threshold = page.getByLabel('阈值', { exact: true })
  await threshold.fill('0.6')
  await threshold.press('Tab')
  await expect.poll(() => mock.config().compact.threshold).toBe(0.6)
})

test('narrow composer keeps model and reasoning controls visible', async ({ page }, testInfo) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('你好')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.rikka-bubble--assistant .markdown-body')).toContainText('一步步实现')

  // 320px 下只剩一个合并入口；菜单和二级窗都不出屏。
  await page.setViewportSize({ width: 320, height: 568 })
  const options = page.locator('.chat-composer__options')
  expect(await options.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  const trigger = page.getByRole('button', { name: /模型与推理（当前 test-model/ })
  await expect(trigger).toBeVisible()
  await expect(page.getByRole('button', { name: '工具权限' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /切换智能体/ })).toHaveCount(0)
  await trigger.click()
  const menu = page.getByRole('menu', { name: '模型与推理' })
  await expect(menu).toBeVisible()
  const menuBox = await menu.boundingBox()
  expect(menuBox.x).toBeGreaterThanOrEqual(0)
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(320)
  await page.getByRole('menuitem', { name: /推理强度/ }).click()
  const levels = page.getByRole('menu', { name: '推理强度' })
  await expect(levels).toBeVisible()
  const levelBox = await levels.boundingBox()
  expect(levelBox.x).toBeGreaterThanOrEqual(0)
  expect(levelBox.x + levelBox.width).toBeLessThanOrEqual(320)
  await screenshot(page, testInfo, 'narrow-composer-menu')
  await levels.getByRole('menuitemradio', { name: '轻', exact: true }).click()
  await expect(trigger).toHaveAccessibleName(/思考强度：轻/)
  expect(mock.errors).toEqual([])
})

test('new chat reasoning is saved before sending', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')

  const trigger = page.getByRole('button', { name: /模型与推理（当前 test-model/ })
  await trigger.click()
  await page.getByRole('menuitem', { name: /推理强度/ }).click()
  await page.getByRole('menu', { name: '推理强度' }).getByRole('menuitemradio', { name: '重', exact: true }).click()
  await expect(trigger).toHaveAccessibleName(/思考强度：重/)

  await page.getByRole('textbox', { name: '消息', exact: true }).fill('你好')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.rikka-bubble--assistant .markdown-body')).toContainText('一步步实现')

  const saved = mock.calls.find(call => call.path === '/session/settings/session-1' && call.body?.reasoning === 'high')
  expect(saved).toBeTruthy()
  const sendIndex = mock.calls.findIndex(call => call.path === '/agent/send/session-1')
  expect(mock.calls.indexOf(saved)).toBeLessThan(sendIndex)
  expect(saved.body).toEqual({ reasoning: 'high' })
  await expect(trigger).toHaveAccessibleName(/思考强度：重/)
  expect(mock.errors).toEqual([])
})

test('select keeps one combobox and chooses from its listbox', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '设置')
  await page.getByRole('button', { name: /通用/ }).click()
  const card = page.locator('.appearance-card')
  await expect(card).toBeVisible()

  // 只暴露一个可访问的组合框，不再维护第二个隐藏的原生 select。
  const combobox = card.getByRole('combobox')
  await expect(combobox).toHaveCount(1)
  await expect(combobox).toHaveAttribute('aria-label', '强调色')
  await expect(card.locator('select')).toHaveCount(0)

  // 点击组合框打开项目自己的选项列表。
  await expect(card.getByRole('listbox')).toBeHidden()
  await combobox.click()
  const listbox = card.getByRole('listbox')
  await expect(listbox).toBeVisible()
  await expect(listbox).toHaveClass(/ui-select__options/)
  await expect(listbox.getByRole('option')).toHaveCount(5)
  await listbox.getByRole('option', { name: '雾蓝', exact: true }).click()

  // 选中后值写回草稿，自动保存再落到 localStorage。
  await expect(listbox).toBeHidden()
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
  const trigger = row.locator('.home-session__menu .ui-menu__trigger')
  const rowBox = await row.boundingBox()
  const triggerBox = await trigger.boundingBox()
  // 48px 图标按钮要和会话行保持同一个垂直中心。
  expect(triggerBox.height).toBeLessThanOrEqual(48)
  expect(Math.abs((rowBox.y + rowBox.height / 2) - (triggerBox.y + triggerBox.height / 2))).toBeLessThanOrEqual(2)

  await trigger.click()
  const popup = page.locator('.ui-menu__popup')
  await expect(popup).toBeVisible()
  const panelBox = await page.locator('.app-drawer .ui-dialog__panel').boundingBox()
  const popupBox = await popup.boundingBox()
  // 弹层贴着行右边缘展开，不能越过抽屉面板，也不能跑出视口。
  expect(popupBox.x).toBeGreaterThanOrEqual(panelBox.x - 1)
  expect(popupBox.x + popupBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1)
  expect(popupBox.y).toBeGreaterThanOrEqual(0)
  expect(popupBox.y + popupBox.height).toBeLessThanOrEqual(panelBox.y + panelBox.height + 1)

  // icon-only 模式只渲染一个“更多”图标，不再补下拉箭头。
  await expect(trigger.locator('svg')).toHaveCount(1)
  await expect(trigger.locator('svg').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(popup).toBeHidden()
  expect(mock.errors).toEqual([])
})

test('new settings pages start at the top and returning restores the parent scroll', async ({ page }) => {
  const mock = await backend(page)
  await page.setViewportSize({ width: page.viewportSize().width, height: 568 })
  await page.goto('/')
  await navigate(page, '设置')
  const scroll = page.locator('.settings-screen[data-page-key="home"] .settings-scroll')
  await expect(page.getByRole('heading', { name: '设置', exact: true, level: 1 })).toBeVisible()

  // 首页滚到底再打开详情，详情必须从顶部开始。
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight })
  await page.getByRole('button', { name: /模型供应商/ }).scrollIntoViewIfNeeded()
  const originalScroll = await scroll.evaluate(element => element.scrollTop)
  await page.getByRole('button', { name: /模型供应商/ }).click()
  await expect(page.getByRole('heading', { name: '模型供应商', exact: true, level: 1 })).toBeVisible()
  const detailScroll = page.locator('.settings-screen[data-page-key="section:providers"] .settings-scroll')
  await expect.poll(() => detailScroll.evaluate(element => element.scrollTop)).toBe(0)

  // 详情使用自己的滚动容器，返回时首页继续停在原位置。
  await detailScroll.evaluate(element => { element.scrollTop = 600 })
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.getByRole('heading', { name: '设置', exact: true, level: 1 })).toBeVisible()
  await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBe(originalScroll)
  expect(mock.errors).toEqual([])
})

test('data settings lists config backups and exports masked config', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '设置')
  await page.getByRole('button', { name: /数据管理/ }).click()
  await expect(page.getByRole('heading', { name: '数据管理', exact: true, level: 1 })).toBeVisible()
  await expect(page.getByText('1 个供应商 · 1 个模型', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: '恢复', exact: true })).toHaveCount(1)

  await page.getByRole('button', { name: '恢复', exact: true }).click()
  const restore = page.getByRole('dialog', { name: '恢复配置备份', exact: true })
  await expect(restore).toContainText('Test Provider · 1 个模型')
  await restore.getByRole('button', { name: '取消', exact: true }).click()

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出脱敏配置', exact: true }).click(),
  ])
  expect(download.suggestedFilename()).toBe('agent-config-masked.json')

  await page.getByRole('switch', { name: '包含 API Key 和其他敏感值' }).click()
  await expect(page.getByRole('button', { name: '导出完整配置', exact: true })).toBeVisible()
  expect(mock.errors).toEqual([])
})

test('session groups move a session through the row menu', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('分组测试')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.rikka-bubble--assistant .markdown-body')).toContainText('一步步实现')
  await openDrawer(page)
  const drawer = page.getByRole('dialog', { name: '项目与会话' })
  await drawer.getByRole('button', { name: '新建分组', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新建分组', exact: true })
  await dialog.getByRole('textbox', { name: '分组名称', exact: true }).fill('工作')
  await dialog.getByRole('button', { name: '创建', exact: true }).click()
  await expect(drawer.getByRole('heading', { name: '工作', exact: true })).toBeVisible()

  const row = drawer.locator('.home-session').last()
  await row.getByRole('button', { name: /更多操作/ }).click()
  await page.getByRole('menuitem', { name: '移到「工作」', exact: true }).click()
  await expect.poll(() => mock.calls.findLast(call => call.path === '/session/groups' && call.method === 'PUT')?.body.groups[0].sessions.length).toBe(1)
  expect(mock.errors).toEqual([])
})

test('workspace picker switches the session cwd and remembers it', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('切换目录测试')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.rikka-bubble--assistant .markdown-body')).toContainText('一步步实现')

  await page.getByRole('button', { name: '更多选项', exact: true }).click()
  await page.getByRole('button', { name: '切换工作区', exact: true }).click()
  const workspace = page.getByRole('dialog', { name: '切换工作区', exact: true })
  await workspace.getByRole('textbox', { name: '目录路径', exact: true }).fill('D:/mock-workspace')
  await workspace.getByRole('button', { name: '切换到此目录', exact: true }).click()
  await expect(workspace).toBeHidden()
  expect(mock.calls.findLast(call => call.path.startsWith('/session/cwd/') && call.method === 'PATCH')?.body.cwd).toBe('D:/mock-workspace')

  await page.getByRole('button', { name: '更多选项', exact: true }).click()
  await page.getByRole('button', { name: '切换工作区', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '切换工作区', exact: true }).getByRole('button', { name: 'D:/mock-workspace', exact: true })).toBeVisible()
  expect(mock.errors).toEqual([])
})

test('conversation rail jumps between user messages and expands lazy history', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  for (let index = 1; index <= 6; index += 1) {
    await page.getByRole('textbox', { name: '消息', exact: true }).fill(`定位消息 ${index}`)
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    await expect(page.locator('.rikka-bubble--assistant .markdown-body').last()).toContainText('一步步实现')
  }

  const rail = page.getByRole('slider', { name: '按用户消息定位', exact: true })
  await expect(rail).toBeVisible()
  await expect(page.locator('.conversation-rail__mark')).toHaveCount(6)
  await expect(page.locator('.conversation-rail__mark.is-active')).toHaveCount(1)

  await rail.focus()
  await rail.press('Home')
  await expect(rail).toHaveAttribute('aria-valuenow', '1')
  await expect(page.locator('.rikka-bubble--user').filter({ hasText: '定位消息 1' })).toBeInViewport()

  const box = await rail.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 2, { steps: 6 })
  await page.mouse.up()
  await expect(rail).toHaveAttribute('aria-valuenow', '6')
  await expect(page.locator('.rikka-bubble--user').filter({ hasText: '定位消息 6' })).toBeInViewport()

  await rail.press('End')
  await expect(rail).toHaveAttribute('aria-valuenow', '6')
  await expect(page.locator('.rikka-bubble--user').filter({ hasText: '定位消息 6' })).toBeInViewport()
  expect(mock.errors).toEqual([])
})

test('restart notice shows stale server version and clears after check', async ({ page }) => {
  const mock = await backend(page)
  mock.setHealth({ version: '0.1.0', targetVersion: '0.2.0', restartRequired: true })
  await page.goto('/')
  const notice = page.locator('.restart-notice')
  await expect(notice).toContainText('需要重启服务')
  await expect(notice).toContainText('运行版本 0.1.0')
  await expect(notice).toContainText('代码版本 0.2.0')
  await expect(notice.getByRole('button', { name: '重新检查', exact: true })).toBeVisible()
  await expect(notice.getByRole('button', { name: /重启/ })).toHaveCount(0)

  mock.setHealth({ version: '0.2.0', targetVersion: '0.2.0', restartRequired: false })
  await notice.getByRole('button', { name: '重新检查', exact: true }).click()
  await expect(notice).toBeHidden()
  expect(mock.errors).toEqual([])
})

test('interleaved assistant text stays chronological in the flat process list', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('keep running')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await page.getByText('正在处理', { exact: true }).waitFor()
  await mock.emit('session-1', [
    { type: 'agent-start' },
    { type: 'tool-call', toolCallId: 'a', toolName: 'read_file', input: { path: 'a.txt' } },
    { type: 'tool-result', toolCallId: 'a', toolName: 'read_file', output: { type: 'text', value: 'a' } },
    { type: 'text-delta', text: '中间先说一句。' },
    { type: 'tool-call', toolCallId: 'b', toolName: 'read_file', input: { path: 'b.txt' } },
    { type: 'tool-result', toolCallId: 'b', toolName: 'read_file', output: { type: 'text', value: 'b' } },
  ])
  await openContextGroups(page)
  await expect(page.locator('.cot-step--tool')).toHaveCount(2)
})

test('subagent tools render as a nested branch under the parent tool', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('keep running')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByText('正在处理', { exact: true })).toBeVisible()

  await mock.emit('session-1', [
    { type: 'agent-start' },
    { type: 'tool-call', toolCallId: 'task-1', toolName: 'new_task', input: { description: '查资料', prompt: '看看目录' } },
    { type: 'subagent-tool', taskId: 'task-1', description: '查资料', toolCallId: 'read-1', toolName: 'read_file', input: { path: 'a.txt' } },
    { type: 'subagent-tool-result', taskId: 'task-1', description: '查资料', toolCallId: 'read-1', output: { type: 'text', value: '内容' } },
  ])

  const branch = page.locator('.subagent-branch')
  await expect(branch).toBeVisible()
  await expect(branch).toContainText('查资料')
  await expect(branch.locator('.cot-step--tool')).toHaveCount(1)
  await expect(branch.locator('.cot-step--tool')).toContainText('读取文件')
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
  const text = chip.locator('.ui-chip__text')
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
  const toolsOverflow = await page.locator('.settings-screen:not([inert]) .settings-scroll').evaluate(element => element.scrollWidth - element.clientWidth)
  expect(toolsOverflow).toBeLessThanOrEqual(1)

  // 提示词多行输入不能把设置卡片撑出 320px 屏幕。
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: /系统提示词/ }).click()
  await expect(page.getByRole('heading', { name: '系统提示词', exact: true, level: 1 })).toBeVisible()
  const overflow = await page.locator('.settings-screen:not([inert]) .settings-scroll').evaluate(element => element.scrollWidth - element.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  expect(mock.errors).toEqual([])
})

test.describe('control motion', () => {
  test.use({ reducedMotion: 'no-preference' })

  test('switch keeps a real thumb transition and moves when toggled', async ({ page }) => {
    await backend(page)
    await page.goto('/')
    await navigate(page, '设置')
    await page.getByRole('button', { name: /通用/ }).click()
    const toggle = page.getByRole('switch', { name: '增强键盘焦点' })
    const thumb = page.locator('.appearance-card .ui-switch', { hasText: '增强键盘焦点' }).locator('.ui-switch__thumb')
    await expect(toggle).not.toBeChecked()

    const duration = await thumb.evaluate(element => getComputedStyle(element).transitionDuration)
    expect(duration).not.toBe('0s')
    expect(duration).toMatch(/\d/)

    const before = await thumb.boundingBox()
    // 透明 input 盖在拇指上，按拇指中心点真实点击一次。
    await page.mouse.click(before.x + before.width / 2, before.y + before.height / 2)
    await expect(toggle).toBeChecked()
    await expect.poll(async () => (await thumb.boundingBox()).x).not.toBeCloseTo(before.x, 1)
  })
})

