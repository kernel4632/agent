import { expect, test } from '@playwright/test'

async function openSection(page, label, selector) {
  await page.goto('/')
  await page.locator('.sidebar__settings').click()
  await page.getByRole('button', { name: label }).click()
  await expect(page.locator(selector)).toBeVisible()
}

async function confirmDelete(page, label) {
  const dialog = page.getByRole('dialog', { name: label })
  await expect(dialog).toBeVisible()
  await page.getByRole('button', { name: '删除', exact: true }).click()
  await expect(dialog).toBeHidden()
}

test('provider add button creates and selects a provider', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop')
  await openSection(page, '供应商配置', '.provider-settings')

  const providers = page.locator('.provider-list m3e-list-action')
  const count = await providers.count()
  const add = page.getByRole('button', { name: '添加供应商' })
  await expect(add).toBeVisible()
  await add.click()

  await expect(providers).toHaveCount(count + 1)
  await expect(page.getByRole('textbox', { name: '供应商名' })).toHaveValue(`Provider ${count + 1}`)
})

test('provider delete confirms before removing', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop')
  await openSection(page, '供应商配置', '.provider-settings')

  const providers = page.locator('.provider-list m3e-list-action')
  const originalCount = await providers.count()
  await page.getByRole('button', { name: '添加供应商' }).click()
  await expect(providers).toHaveCount(originalCount + 1)
  await page.getByRole('button', { name: '删除供应商' }).click()

  const dialog = page.getByRole('dialog', { name: '删除供应商？' })
  await expect(dialog).toBeVisible()
  await page.getByRole('button', { name: '取消' }).click()
  await expect(dialog).toBeHidden()
  await expect(providers).toHaveCount(originalCount + 1)

  await page.getByRole('button', { name: '删除供应商' }).click()
  await confirmDelete(page, '删除供应商？')
  await expect(providers).toHaveCount(originalCount)
})

test('MCP add selects, and delete requires confirmation', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop')
  await openSection(page, 'MCP 管理', '.mcp-settings')

  const servers = page.locator('.mcp-settings__list m3e-list-action')
  const originalCount = await servers.count()
  await page.getByRole('button', { name: '添加 MCP 服务' }).click()
  await expect(servers).toHaveCount(originalCount + 1)
  await expect(page.locator('.mcp-settings__form input').first()).toHaveValue(`MCP ${originalCount + 1}`)
  await page.getByRole('button', { name: '删除此服务' }).click()

  const dialog = page.getByRole('dialog', { name: '删除 MCP 服务？' })
  await expect(dialog).toBeVisible()
  await page.getByRole('button', { name: '取消' }).click()
  await expect(dialog).toBeHidden()
  await expect(servers).toHaveCount(originalCount + 1)

  await page.getByRole('button', { name: '删除此服务' }).click()
  await confirmDelete(page, '删除 MCP 服务？')
  await expect(servers).toHaveCount(originalCount)
})

test('an empty provider collection can recover through the header add action', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop')
  await openSection(page, '供应商配置', '.provider-settings')

  const providers = page.locator('.provider-list m3e-list-action')
  while (await providers.count()) {
    await page.getByRole('button', { name: '删除供应商' }).click()
    await confirmDelete(page, '删除供应商？')
  }
  await expect(page.getByText('添加一个供应商以开始配置')).toBeVisible()

  await page.getByRole('button', { name: '添加供应商' }).click()
  await expect(providers).toHaveCount(1)
  await expect(page.getByRole('textbox', { name: '供应商名' })).toHaveValue('Provider 1')
})

test('saving settings PATCHes every provider including visible edits', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop')
  let capturedPatch
  let currentConfig = {
    providers: [{
      name: 'Existing Provider',
      baseURL: 'https://existing.example/v1',
      key: 'existing-key',
      models: [{ id: 'existing-model', contextWindow: 64000, maxOutput: 8000 }],
    }],
    prompts: { system: 'Test prompt' },
    permission: [],
    mcp: {},
  }
  await page.route('**/api/config', async route => {
    if (route.request().method() === 'PATCH') {
      capturedPatch = route.request().postDataJSON()
      currentConfig = { ...currentConfig, ...capturedPatch }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(currentConfig) })
  })

  await openSection(page, '供应商配置', '.provider-settings')
  await page.getByRole('button', { name: '添加供应商' }).click()
  await page.getByRole('textbox', { name: '供应商名' }).fill('Persisted Provider')
  await page.getByRole('textbox', { name: '请求地址（API）' }).fill('https://persisted.example/v1')
  await page.getByRole('treeitem', { name: '主页' }).click()

  await expect(page.locator('.home-page')).toBeVisible()
  await expect.poll(() => capturedPatch).toBeTruthy()
  expect(capturedPatch.providers).toHaveLength(2)
  expect(capturedPatch.providers[0]).toEqual({
    name: 'Existing Provider',
    baseURL: 'https://existing.example/v1',
    key: 'existing-key',
    enabled: true,
    protocol: 'openai-compatible',
    models: [{ id: 'existing-model', contextWindow: 64000, maxOutput: 8000 }],
  })
  expect(capturedPatch.providers[1]).toEqual({
    name: 'Persisted Provider',
    baseURL: 'https://persisted.example/v1',
    key: '',
    enabled: true,
    protocol: 'openai-compatible',
    models: [],
  })
})

test('saving an empty provider collection PATCHes an empty array', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop')
  let capturedPatch
  let currentConfig = {
    providers: [{ name: 'Only Provider', baseURL: '', key: '', models: [] }],
    prompts: { system: '' },
    permission: [],
    mcp: {},
  }
  await page.route('**/api/config', async route => {
    if (route.request().method() === 'PATCH') {
      capturedPatch = route.request().postDataJSON()
      currentConfig = { ...currentConfig, ...capturedPatch }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(currentConfig) })
  })

  await openSection(page, '供应商配置', '.provider-settings')
  await page.getByRole('button', { name: '删除供应商' }).click()
  await confirmDelete(page, '删除供应商？')
  await page.getByRole('treeitem', { name: '主页' }).click()

  await expect(page.locator('.home-page')).toBeVisible()
  await expect.poll(() => capturedPatch).toBeTruthy()
  expect(capturedPatch.providers).toEqual([])
})
