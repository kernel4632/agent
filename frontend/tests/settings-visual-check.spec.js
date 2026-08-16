import { test } from '@playwright/test'

test('capture current settings pages', async ({ page }) => {
  await page.goto('/')
  await page.locator('.sidebar [aria-label="设置"]').first().click()
  await page.waitForSelector('.settings-page')
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'test-results/settings-overview-current.png', fullPage: true })
  const providersItem = page.locator('.settings-navigation m3e-list-action[aria-label="供应商配置"]')
  await providersItem.hover()
  await page.screenshot({ path: 'test-results/settings-overview-hover.png', fullPage: true })
  await providersItem.click()
  await page.screenshot({ path: 'test-results/settings-providers-current.png', fullPage: true })

  await page.locator('[aria-label="返回设置"]').click()
  await page.locator('.settings-navigation m3e-list-action[aria-label="工具管理"]').click()
  await page.screenshot({ path: 'test-results/settings-tools-current.png', fullPage: true })

  await page.locator('[aria-label="返回设置"]').click()
  await page.locator('.settings-navigation m3e-list-action[aria-label="语言与外观"]').click()
  await page.screenshot({ path: 'test-results/settings-appearance-current.png', fullPage: true })

  await page.locator('[aria-label="返回设置"]').click()
  await page.locator('.settings-navigation m3e-list-action[aria-label="系统提示词定义"]').click()
  await page.screenshot({ path: 'test-results/settings-prompts-current.png', fullPage: true })
})
