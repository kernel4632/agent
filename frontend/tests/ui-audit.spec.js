import { expect, test } from '@playwright/test'

async function capture(page, testInfo, name) {
  await page.waitForTimeout(400)
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
    const describe = (element) => `${element.tagName.toLowerCase()}${element.className ? `.${String(element.className).trim().replace(/\s+/g, '.')}` : ''}`
    const viewportEscapes = []
    const undersizedControls = []
    const clippedLabels = []
    const italicElements = []

    for (const element of document.querySelectorAll('mdui-button, mdui-button-icon, mdui-card, mdui-text-field, mdui-select, mdui-chip')) {
      if (!visible(element)) continue
      const box = element.getBoundingClientRect()
      if (box.left < -1 || box.right > innerWidth + 1) viewportEscapes.push({ element: describe(element), left: box.left, right: box.right })
      if (element.matches('mdui-button-icon') && !element.closest('.message-map > div') && (box.width < 38 || box.height < 38)) undersizedControls.push({ element: describe(element), width: box.width, height: box.height })
      if (element.matches('mdui-button') && box.height < 36) undersizedControls.push({ element: describe(element), width: box.width, height: box.height })
      if (element.matches('mdui-button') && element.scrollWidth > element.clientWidth + 2) clippedLabels.push({ element: describe(element), text: element.textContent.trim(), width: box.width, scrollWidth: element.scrollWidth })
    }

    const nativeVisible = [...document.querySelectorAll('button, input:not([type="file"]), select, textarea')]
      .filter(visible)
      .map(describe)

    for (const element of document.querySelectorAll('h1, h2, h3, p, strong, small, mdui-button, mdui-text-field, mdui-select')) {
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
  await page.locator('.settings-nav mdui-button').filter({ hasText: label }).click()
  await page.waitForTimeout(120)
}

test('desktop screenshot and interaction matrix', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop')
  const runtimeErrors = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  await page.goto('/')

  await capture(page, testInfo, '01-home')
  await page.locator('.panel-heading mdui-button-icon').first().click()
  await capture(page, testInfo, '02-add-workspace-dialog')
  await page.locator('mdui-dialog[open] mdui-button[slot="action"]').first().click()

  await page.locator('.home-session__actions mdui-button-icon').first().click()
  await capture(page, testInfo, '03-session-rename')
  await page.keyboard.press('Escape')
  await page.locator('.home-session__actions mdui-button-icon').nth(1).click()
  await capture(page, testInfo, '04-delete-session-dialog')
  await page.locator('mdui-dialog[open] mdui-button').first().click()

  await page.reload()
  await page.locator('.home-session').first().click()
  await capture(page, testInfo, '05-chat')

  const waitingTool = page.locator('.tool-strip.is-waiting')
  await waitingTool.scrollIntoViewIfNeeded()
  await capture(page, testInfo, '06-tool-approval')
  await waitingTool.locator('mdui-button').filter({ hasText: '始终允许' }).click()
  await capture(page, testInfo, '07-tool-approved')

  await page.locator('.tool-strip').first().click()
  await capture(page, testInfo, '08-tool-expanded')
  await page.locator('.tool-strip mdui-button-icon[title]').first().click()
  await capture(page, testInfo, '09-rollback-dialog')
  await page.locator('mdui-dialog[open] mdui-button').first().click()

  await page.locator('.model-select').click()
  await capture(page, testInfo, '10-model-menu')
  await page.keyboard.press('Escape')

  await page.locator('.composer__input textarea').fill('检查流式状态的组件布局')
  await page.locator('mdui-button-icon[aria-label="发送"]').click()
  await capture(page, testInfo, '11-chat-running')
  await page.locator('mdui-button-icon[aria-label="暂停生成"]').click()
  await capture(page, testInfo, '12-chat-paused')

  await page.locator('.sidebar__fifth mdui-button').click()
  await capture(page, testInfo, '13-settings-providers')
  await page.locator('.provider-models mdui-button').click()
  await capture(page, testInfo, '14-model-picker-loading')
  await page.waitForTimeout(700)
  await capture(page, testInfo, '15-model-picker-dialog')
  await page.locator('mdui-dialog[open] mdui-button[slot="action"]').click()
  await page.locator('.provider-model-list mdui-button-icon').first().click()
  await capture(page, testInfo, '16-model-settings-dialog')
  await page.locator('mdui-dialog[open] mdui-button[slot="action"]').click()

  for (const [label, name] of [
    ['工具管理', '16-settings-tools'],
    ['MCP 管理', '17-settings-mcp'],
    ['系统提示词定义', '19-settings-prompt'],
    ['数据管理', '20-settings-data'],
    ['语言与外观', '22-settings-appearance'],
  ]) {
    await openSettingsSection(page, label)
    await capture(page, testInfo, name)
    if (label === 'MCP 管理') {
      await page.locator('.simple-settings__heading mdui-button').click()
      await capture(page, testInfo, '18-settings-mcp-added')
    }
    if (label === '数据管理') {
      await page.locator('.data-settings mdui-button').first().click()
      await capture(page, testInfo, '21-settings-data-feedback')
    }
  }

  await page.locator('.simple-settings > mdui-select').first().click()
  await page.locator('mdui-menu-item').filter({ hasText: 'English' }).click()
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
  await page.locator('mdui-button-icon[aria-label="收起侧边栏"]').click()
  await capture(page, testInfo, '02-mobile-home')
  await page.locator('.home-session').first().click()
  await capture(page, testInfo, '03-mobile-chat')
  await page.locator('mdui-button-icon[aria-label="展开侧边栏"]').click()
  await page.locator('.sidebar__fifth mdui-button').click()
  await expect(page.locator('.settings-content')).toBeVisible()
  await capture(page, testInfo, '04-mobile-settings')

  await expectHealthyLayout(page)
  expect(runtimeErrors).toEqual([])
})
