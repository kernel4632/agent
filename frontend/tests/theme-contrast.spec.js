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
  await page.locator('.settings-navigation m3e-list-action[aria-label="外观"]').click()

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
    await page.keyboard.press('Escape')
    await expect(page.locator('m3e-theme')).toHaveAttribute('scheme', expected)
    await expect(page.locator('.appearance-settings')).toBeVisible()
  }

  await page.locator('m3e-nav-menu-item[aria-label="主页"]').click()
  await expect.poll(() => page.evaluate(() => (
    JSON.parse(localStorage.getItem('agent.appearance'))?.theme
  ))).toBe('system')
  expect(pageErrors).toEqual([])
})

test('appearance controls update and persist the complete M3E theme', async ({ page }) => {
  await page.goto('/')
  await page.locator('.sidebar__settings').click()
  await page.locator('.settings-navigation m3e-list-action[aria-label="外观"]').click()

  const theme = page.locator('m3e-theme')
  const originalPrimary = await theme.evaluate(element => getComputedStyle(element).getPropertyValue('--md-sys-color-primary'))
  await page.locator('input[aria-label="主题颜色"]').evaluate((input) => {
    input.value = '#d00036'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect(theme).toHaveAttribute('color', '#d00036')
  await expect.poll(() => theme.evaluate(element => getComputedStyle(element).getPropertyValue('--md-sys-color-primary'))).not.toBe(originalPrimary)

  async function chooseSetting(label, optionIndex) {
    const selector = page.locator(`m3e-list-item:has-text("${label}") m3e-select`).first()
    await selector.click()
    await page.keyboard.press('Home')
    for (let index = 0; index < optionIndex; index += 1) await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
  }

  await chooseSetting('色板风格', 4)
  await chooseSetting('对比度', 2)
  await chooseSetting('界面密度', 2)
  await chooseSetting('动效风格', 0)
  await expect(theme).toHaveAttribute('variant', 'expressive')
  await expect(theme).toHaveAttribute('contrast', 'high')
  await expect(theme).toHaveAttribute('density', '-2')
  await expect(theme).toHaveAttribute('motion', 'standard')

  await page.locator('m3e-switch[aria-label="增强焦点指示器"]').click()
  await expect(theme).toHaveAttribute('strong-focus', '')

  await page.locator('m3e-nav-menu-item[aria-label="主页"]').click()
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('agent.appearance')))).toMatchObject({
    color: '#d00036',
    variant: 'expressive',
    contrast: 'high',
    density: -2,
    motion: 'standard',
    strongFocus: true,
  })

  await page.reload()
  await expect(theme).toHaveAttribute('color', '#d00036')
  await expect(theme).toHaveAttribute('strong-focus', '')
})
