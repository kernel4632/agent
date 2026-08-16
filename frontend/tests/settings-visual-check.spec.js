import { test } from '@playwright/test'

test('capture current settings pages', async ({ page }) => {
  await page.goto('/')
  await page.locator('.sidebar__settings').click()
  await page.waitForSelector('.settings-page')
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'test-results/settings-providers-current.png', fullPage: true })

  await page.locator('m3e-icon-button[aria-label="工具管理"]').click()
  await page.screenshot({ path: 'test-results/settings-tools-current.png', fullPage: true })

  await page.locator('m3e-icon-button[aria-label="语言与外观"]').click()
  await page.screenshot({ path: 'test-results/settings-appearance-current.png', fullPage: true })

  await page.locator('m3e-icon-button[aria-label="系统提示词定义"]').click()
  await page.screenshot({ path: 'test-results/settings-prompts-current.png', fullPage: true })
})
