import { test, expect } from '@playwright/test'
import { backend, navigate } from './chat-fixture.js'

test('reload restores the open conversation and scroll position', async ({ page }) => {
  const mock = await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('textbox', { name: '消息', exact: true }).fill('你好')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.rikka-bubble--assistant .markdown-body')).toContainText('一步步实现')

  // 给这条会话补足够长的历史，滚动才有意义；写完再刷新，让前端按真实历史重排。
  const session = mock.sessions.get('session-1')
  for (let index = 0; index < 8; index += 1) {
    session.history.push({ messageId: `extra-user-${index}`, role: 'user', content: `第 ${index} 个问题` })
    session.history.push({
      messageId: `extra-assistant-${index}`,
      role: 'assistant',
      content: [{ type: 'text', text: `第 ${index} 个回答\n\n${'这是一段很长的内容。'.repeat(80)}` }],
    })
  }

  await page.reload()
  const scroll = page.locator('.session-scroll')
  await expect(scroll).toBeVisible()
  await page.waitForTimeout(300)
  await scroll.evaluate(element => { element.scrollTop = 600 })
  await page.waitForTimeout(350)
  const before = await scroll.evaluate(element => element.scrollTop)
  expect(before).toBeGreaterThan(100)

  await page.reload()
  await expect(page.locator('.session-conversation')).toBeVisible()
  await expect(page.locator('.session-scroll')).toBeVisible()
  await page.waitForTimeout(500)
  const after = await page.locator('.session-scroll').evaluate(element => element.scrollTop)
  expect(Math.abs(after - before)).toBeLessThan(40)
})
