import { expect, test } from '@playwright/test'
import { backend, openDrawer } from './chat-fixture.js'

test('speed panel shows the streaming request before it finishes', async ({ page }) => {
  const mock = await backend(page)
  mock.sessions.set('live-stats', {
    id: 'live-stats',
    title: '实时速度',
    provider: 'Test Provider',
    model: 'test-model',
    history: [{ messageId: 'u1', role: 'user', content: '开始' }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    settings: { reasoning: 'auto' },
    todos: [],
    running: true,
    pending: [],
    undoable: 0,
  })
  await page.goto('/')
  await openDrawer(page)
  await page.getByRole('button', { name: '实时速度', exact: true }).click()

  await mock.emit('live-stats', [
    { type: 'llm-start', startedAt: Date.now() - 3000, provider: 'Test Provider', model: 'test-model' },
    { type: 'text-delta', text: '正在持续输出的内容'.repeat(20) },
  ])
  await expect(page.locator('.session-composer__stats')).toBeVisible()
  const stats = page.locator('.session-composer__stats')
  await stats.getByRole('button', { name: /tok\/s/ }).click()
  const panel = page.getByRole('dialog', { name: '生成速度' })
  const liveRow = panel.locator('.stats-panel__speed-row.is-live')
  await expect(liveRow).toContainText('test-model')
  await expect(liveRow.locator('.stats-panel__speed-tps')).toContainText(/\d+/)
  await expect(liveRow.locator('.stats-panel__speed-tps')).not.toContainText('—')

  await mock.emit('live-stats', [{ type: 'text-delta', text: '再追加一段'.repeat(40) }])
  await expect(liveRow.locator('.stats-panel__speed-tps')).toContainText('tok/s')
  expect(mock.errors).toEqual([])
})
