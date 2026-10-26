import { test } from '@playwright/test'
import { backend, navigate } from './chat-fixture.js'

test.use({ viewport: { width: 390, height: 844 } })

test('permission listbox look', async ({ page }) => {
  await backend(page)
  await page.goto('/')
  await navigate(page, '新建对话')
  await page.getByRole('button', { name: '权限控制', exact: true }).click()
  await page.getByRole('dialog', { name: '自动批准' }).getByRole('option', { name: '读取', exact: true }).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'test-results/permission-listbox.png', animations: 'disabled' })
})
