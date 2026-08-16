import { expect, test } from '@playwright/test'

const themeCases = [
  { theme: 'light', system: 'dark', expected: 'light' },
  { theme: 'dark', system: 'light', expected: 'dark' },
  { theme: 'system', system: 'light', expected: 'light' },
  { theme: 'system', system: 'dark', expected: 'dark' },
]

for (const themeCase of themeCases) {
  test(`${themeCase.theme} theme with ${themeCase.system} system scheme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: themeCase.system })
    await page.addInitScript((theme) => {
      localStorage.setItem('agent.appearance', JSON.stringify({
        theme,
        animations: true,
      }))
    }, themeCase.theme)

    await page.goto('/')
    await page.locator('.sidebar__settings').click()
    await expect(page.locator('.settings-navigation')).toBeVisible()
    await expect(page.locator('m3e-theme')).toHaveAttribute('scheme', themeCase.expected)

    const items = page.locator('.settings-navigation m3e-list-action')
    await expect(items).toHaveCount(6)

    const colors = await items.evaluateAll(elements => elements.map(item => getComputedStyle(item.querySelector('svg')).color))
    for (const computed of colors) {
      expect(computed).not.toBe('rgba(0, 0, 0, 0)')
    }
  })
}

test('appearance selector previews and persists the theme', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await page.locator('.sidebar__settings').click()
  await page.locator('.settings-navigation m3e-list-action[aria-label="语言与外观"]').click()

  for (const [theme, expected] of [
    ['light', 'light'],
    ['dark', 'dark'],
    ['system', 'dark'],
  ]) {
    const selector = page.locator('.appearance-settings__select m3e-select').first()
    await selector.click()
    await page.keyboard.press('Home')
    for (let index = 0; index < { system: 0, light: 1, dark: 2 }[theme]; index += 1) {
      await page.keyboard.press('ArrowDown')
    }
    await page.keyboard.press('Enter')
    await expect(page.locator('m3e-theme')).toHaveAttribute('scheme', expected)
    await expect(page.locator('.appearance-settings')).toBeVisible()
  }

  await page.locator('m3e-nav-menu-item[aria-label="主页"]').click()
  await expect.poll(() => page.evaluate(() => (
    JSON.parse(localStorage.getItem('agent.appearance'))?.theme
  ))).toBe('system')
  expect(pageErrors).toEqual([])
})
