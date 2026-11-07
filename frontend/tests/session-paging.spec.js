import { expect, test } from '@playwright/test'
import { backend, openDrawer } from './chat-fixture.js'

test('long session loads history pages and keeps the full outline', async ({ page }) => {
  const mock = await backend(page)
  const history = []
  for (let index = 0; index < 225; index += 1) {
    history.push({ messageId: `page-u${index}`, role: 'user', content: `第 ${index} 轮` })
    history.push({ messageId: `page-a${index}`, role: 'assistant', content: [{ type: 'text', text: `回复 ${index}` }] })
  }
  mock.sessions.set('page-1', {
    id: 'page-1',
    title: '分页长会话',
    provider: 'Test Provider',
    model: 'test-model',
    history,
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
  await page.getByRole('button', { name: '分页长会话', exact: true }).click()
  await expect(page.locator('.topbar h1')).toHaveText('分页长会话')

  const rail = page.getByRole('slider', { name: '按消息定位', exact: true })
  await expect(rail).toHaveAttribute('aria-valuemax', '225')
  await expect.poll(() => page.locator('.rikka-bubble--user').count()).toBeGreaterThan(0)
  const before = await page.locator('.rikka-bubble--user').count()
  expect(before).toBeGreaterThan(0)
  expect(before).toBeLessThan(225)

  const scroll = page.locator('.session-scroll')
  await scroll.evaluate(element => { element.scrollTop = 0 })
  await expect.poll(() => page.locator('.rikka-bubble--user').count()).toBeGreaterThan(before)
  expect(await rail.getAttribute('aria-valuemax')).toBe('225')

  // 从定位条直接跳到第一轮：只换入包含目标的一页，不把中间历史全部挂上。
  await rail.focus()
  await rail.press('Home')
  await expect(page.locator('.rikka-bubble--user').filter({ hasText: '第 0 轮' })).toBeInViewport()
  expect(await page.locator('.rikka-bubble--user').count()).toBeLessThan(225)
  expect(await rail.getAttribute('aria-valuemax')).toBe('225')
  expect(mock.errors).toEqual([])
})
