import { expect, test } from '@playwright/test'

test('audit M3E button hover elevation sources', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('.sidebar')

  const selectors = [
    ['sidebar', 'm3e-nav-menu-item[aria-label="主页"]'],
    ['add-workspace', '.home-page__pane-header m3e-button'],
  ]

  for (const [name, selector] of selectors) {
    const button = page.locator(selector).first()
    await button.hover()
    const result = await button.evaluate((element) => {
      const internalElements = [...(element.shadowRoot?.querySelectorAll('*') || [])]
      const internalShadows = internalElements
        .map(node => ({ tag: node.tagName, shadow: getComputedStyle(node).boxShadow }))
        .filter(({ shadow }) => shadow && shadow !== 'none')
      return {
        variant: element.getAttribute('variant') || 'default',
        hostShadow: getComputedStyle(element).boxShadow,
        internalShadows,
        elevationToken: getComputedStyle(element).getPropertyValue('--m3e-button-container-elevation').trim(),
      }
    })
    console.log(name, result)
    expect(result.hostShadow).toBe('none')
    expect(result.internalShadows).toEqual([])
  }
})
