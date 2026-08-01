import { expect, test } from '@playwright/test'

async function capture(page, testInfo, name) {
  await page.waitForTimeout(1250)
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true })
  await testInfo.attach(name, { path, contentType: 'image/png' })
  await expectHealthyLayout(page)
}

async function layoutDiagnostics(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element)
      const box = element.getBoundingClientRect()
      return style.visibility !== 'hidden' && style.display !== 'none' && box.width > 0 && box.height > 0
    }
    const describe = (element) => {
      const self = `${element.tagName.toLowerCase()}${element.className ? `.${String(element.className).trim().replace(/\s+/g, '.')}` : ''}`
      const parent = element.parentElement
      return parent?.className ? `${self} in .${String(parent.className).trim().replace(/\s+/g, '.')}` : self
    }
    const viewportEscapes = []
    const undersizedControls = []
    const clippedLabels = []
    const italicElements = []

    for (const element of document.querySelectorAll('m3e-button, m3e-icon-button, m3e-card, m3e-form-field, m3e-select, m3e-input-chip')) {
      if (!visible(element)) continue
      const box = element.getBoundingClientRect()
      if (box.left < -1 || box.right > innerWidth + 1) {
        const parentBox = element.parentElement?.getBoundingClientRect()
        viewportEscapes.push({ element: describe(element), left: box.left, right: box.right, parentLeft: parentBox?.left, parentRight: parentBox?.right })
      }
      if (element.matches('m3e-icon-button') && !element.closest('.message-map') && (box.width < 38 || box.height < 38)) undersizedControls.push({ element: describe(element), width: box.width, height: box.height })
      if (element.matches('m3e-button') && box.height < 36) undersizedControls.push({ element: describe(element), width: box.width, height: box.height })
      if (element.matches('m3e-button') && element.scrollWidth > element.clientWidth + 2) clippedLabels.push({ element: describe(element), text: element.textContent.trim(), width: box.width, scrollWidth: element.scrollWidth })
    }

    const nativeVisible = [...document.querySelectorAll('button, input:not([type="file"]), select, textarea')]
      .filter((element) => visible(element) && !element.matches('input, .message-map__mark') && !element.closest('m3e-form-field, m3e-search-bar'))
      .map(describe)

    for (const element of document.querySelectorAll('h1, h2, h3, p, strong, small, m3e-button, m3e-form-field, m3e-select')) {
      if (visible(element) && getComputedStyle(element).fontStyle !== 'normal') italicElements.push({ element: describe(element), text: element.textContent.trim().slice(0, 80), fontStyle: getComputedStyle(element).fontStyle })
    }

    return {
      documentOverflow: document.documentElement.scrollWidth - innerWidth,
      nativeVisible,
      viewportEscapes,
      undersizedControls,
      clippedLabels,
      italicElements,
      fontStyle: getComputedStyle(document.body).fontStyle,
    }
  })
}

async function expectHealthyLayout(page) {
  const diagnostics = await layoutDiagnostics(page)
  expect(diagnostics.documentOverflow, JSON.stringify(diagnostics, null, 2)).toBeLessThanOrEqual(0)
  expect(diagnostics.nativeVisible, JSON.stringify(diagnostics, null, 2)).toEqual([])
  expect(diagnostics.viewportEscapes, JSON.stringify(diagnostics, null, 2)).toEqual([])
  expect(diagnostics.undersizedControls, JSON.stringify(diagnostics, null, 2)).toEqual([])
  expect(diagnostics.clippedLabels, JSON.stringify(diagnostics, null, 2)).toEqual([])
  expect(diagnostics.italicElements, JSON.stringify(diagnostics, null, 2)).toEqual([])
  expect(diagnostics.fontStyle).toBe('normal')
}

async function openSettingsSection(page, label) {
  await page.locator('.settings-nav m3e-button').filter({ hasText: label }).click()
  await page.waitForTimeout(120)
}

test('desktop screenshot and interaction matrix', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop')
  const runtimeErrors = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  await page.goto('/')

  await capture(page, testInfo, '01-home')
  await page.locator('.icon-command[aria-label="收起侧边栏"]').click()
  await capture(page, testInfo, '01-home-collapsed-rail')
  await page.locator('.icon-command[aria-label="展开侧边栏"]').click()
  await page.locator('.panel-heading m3e-icon-button').first().click()
  await capture(page, testInfo, '02-add-workspace-dialog')
  await page.locator('m3e-dialog[open] [slot="actions"] m3e-button').first().click()
  await page.locator('.sidebar__second m3e-button').nth(1).click()
  await page.locator('.sidebar__second m3e-button').first().click()
  await page.waitForTimeout(300)

  await page.locator('.home-session__actions m3e-icon-button').first().click()
  await capture(page, testInfo, '03-session-rename')
  await page.keyboard.press('Escape')
  await page.locator('.home-session__actions m3e-icon-button').nth(1).click()
  await capture(page, testInfo, '04-delete-session-dialog')
  await page.locator('m3e-dialog[open] m3e-button').first().click()

  await page.reload()
  await page.locator('.home-session').first().click()
  await capture(page, testInfo, '05-chat')
  await expect(page.locator('.model-select m3e-select')).toContainText(/glm-5\.2|kimi-k2\.6/)

  await page.locator('.composer__input textarea').fill('请只回复 UI_REAL_OK，不要调用工具。')
  await page.locator('m3e-icon-button[aria-label="发送"]').click()
  await capture(page, testInfo, '11-chat-running')
  await expect(page.locator('.message--assistant')).toContainText('UI_REAL_OK', { timeout: 30_000 })
  await capture(page, testInfo, '12-chat-finished')

  await page.locator('.sidebar__fifth m3e-button').click()
  await capture(page, testInfo, '13-settings-providers')
  await page.locator('.provider-models m3e-button').click()
  await expect(page.locator('.model-picker-loading')).toBeVisible()
  await capture(page, testInfo, '14-model-picker-loading')
  await page.waitForTimeout(350)
  await capture(page, testInfo, '15-model-picker-dialog')
  await page.locator('m3e-dialog[open] [slot="actions"] m3e-button').click()
  if (await page.locator('.provider-model-list m3e-icon-button').count()) {
    await page.locator('.provider-model-list m3e-icon-button').first().click()
    await capture(page, testInfo, '16-model-settings-dialog')
    await page.locator('m3e-dialog[open] [slot="actions"] m3e-button').click()
  }

  for (const [label, name] of [
    ['工具管理', '16-settings-tools'],
    ['MCP 管理', '17-settings-mcp'],
    ['系统提示词定义', '19-settings-prompt'],
    ['数据管理', '20-settings-data'],
    ['语言与外观', '22-settings-appearance'],
  ]) {
    await openSettingsSection(page, label)
    await capture(page, testInfo, name)
    if (label === '工具管理') {
      await expect(page.locator('.tool-setting-row m3e-select').first()).toContainText('允许')
      await page.locator('.tool-setting-row m3e-select').first().click()
      await capture(page, testInfo, '16-settings-tool-permission-menu')
      await page.keyboard.press('Escape')
    }
    if (label === 'MCP 管理') {
      await page.locator('.simple-settings__heading m3e-button').click()
      await capture(page, testInfo, '18-settings-mcp-added')
    }
    if (label === '数据管理') {
      await page.locator('.data-settings m3e-button').first().click()
      await capture(page, testInfo, '21-settings-data-feedback')
    }
  }

  await expect(page.locator('.simple-settings > m3e-form-field m3e-select').first()).toContainText('简体中文')
  await expect(page.locator('.simple-settings > m3e-form-field m3e-select').nth(1)).toContainText('舒适')
  await page.locator('.simple-settings > m3e-form-field m3e-select').first().click()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await capture(page, testInfo, '23-settings-english')

  await expectHealthyLayout(page)
  expect(runtimeErrors).toEqual([])
})

test('mobile screenshot and interaction matrix', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile')
  const runtimeErrors = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  await page.goto('/')

  await capture(page, testInfo, '01-mobile-sidebar')
  const collapse = page.locator('m3e-icon-button[aria-label="收起侧边栏"]')
  if (await collapse.count()) await collapse.click()
  await page.locator('.sidebar__second m3e-button').nth(1).click()
  await page.locator('.sidebar__second m3e-button').first().click()
  await page.waitForTimeout(300)
  await capture(page, testInfo, '02-mobile-home')
  await page.locator('.home-session').first().click()
  await capture(page, testInfo, '03-mobile-chat')
  await page.locator('m3e-icon-button[aria-label="展开侧边栏"]').click()
  await page.locator('.sidebar__fifth m3e-button').click()
  await expect(page.locator('.settings-content')).toBeVisible()
  await capture(page, testInfo, '04-mobile-settings')
  await page.locator('.provider-models').scrollIntoViewIfNeeded()
  await capture(page, testInfo, '05-mobile-provider-models')
  await openSettingsSection(page, '工具管理')
  await capture(page, testInfo, '06-mobile-settings-tools')
  await openSettingsSection(page, 'MCP 管理')
  await capture(page, testInfo, '07-mobile-settings-mcp')
  await openSettingsSection(page, '语言与外观')
  await capture(page, testInfo, '08-mobile-settings-appearance')

  await expectHealthyLayout(page)
  expect(runtimeErrors).toEqual([])
})
