import { test } from '@playwright/test'

test('audit sidebar nav layout', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('.sidebar')
  console.log(await page.locator('.sidebar').evaluate((sidebar) => {
    const result = {}
    for (const selector of ['.sidebar__header', '.sidebar__logo', '.sidebar__toggle', '.sidebar__actions', '.sidebar__footer']) {
      const element = sidebar.querySelector(selector)
      const rect = element?.getBoundingClientRect()
      const style = element ? getComputedStyle(element) : null
      result[selector] = { rect: rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, display: style?.display, color: style?.color, opacity: style?.opacity }
    }
    return result
  }))
  await page.screenshot({ path: 'test-results/sidebar-nav-current.png', fullPage: true })
})
