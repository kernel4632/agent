import { test, expect } from '@playwright/test'
import { backend, navigate } from './chat-fixture.js'

test('bottom follow survives streaming and releases on wheel up', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', '合成滚轮只在桌面项目里验证')

  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('keep running')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByText('正在处理', { exact: true })).toBeVisible()

  const scroll = page.locator('.session-scroll')
  const chunk = '这是一段用来验证滚动跟随的内容。'.repeat(30)
  for (let index = 0; index < 8; index += 1) {
    await mock.emit('session-1', [{ type: 'text-delta', text: chunk }])
  }
  await page.waitForTimeout(500)

  const distance = () => scroll.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)
  expect(await scroll.evaluate(element => getComputedStyle(element).overflowAnchor)).toBe('none')
  await expect.poll(distance, { timeout: 3000 }).toBeLessThan(4)
  await expect(page.locator('.conversation-latest')).toBeHidden()

  // 用户向上滚轮：真正的意图，停止跟随；之后新增内容不能把他拽回底部。
  await scroll.hover()
  await page.mouse.wheel(0, -500)
  await page.waitForTimeout(300)
  await expect(page.locator('.conversation-latest')).toBeVisible()
  const before = await scroll.evaluate(element => element.scrollTop)

  await mock.emit('session-1', [{ type: 'text-delta', text: chunk }])
  await page.waitForTimeout(400)
  const after = await scroll.evaluate(element => element.scrollTop)
  expect(Math.abs(after - before)).toBeLessThan(4)

  // 回到最新：重新跟随并贴到底部。
  await page.locator('.conversation-latest').click()
  await page.waitForTimeout(300)
  await expect.poll(distance, { timeout: 3000 }).toBeLessThan(4)
  await expect(page.locator('.conversation-latest')).toBeHidden()

  // 再往上滚，然后直接用滚轮滚回底部，也应该自动恢复跟随。
  await scroll.hover()
  await page.mouse.wheel(0, -500)
  await page.waitForTimeout(200)
  await expect(page.locator('.conversation-latest')).toBeVisible()
  await page.mouse.wheel(0, 5000)
  await page.waitForTimeout(300)
  await expect.poll(distance, { timeout: 3000 }).toBeLessThan(4)
  await expect(page.locator('.conversation-latest')).toBeHidden()
})
