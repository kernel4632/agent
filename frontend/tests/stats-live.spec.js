import { expect, test } from '@playwright/test'
import { backend, openDrawer } from './chat-fixture.js'

test('waiting for the first token keeps the last measured speed', async ({ page }) => {
  const mock = await backend(page)
  mock.sessions.set('wait-stats', {
    id: 'wait-stats',
    title: '等待首字',
    provider: 'Test Provider',
    model: 'test-model',
    history: [
      { messageId: 'u1', role: 'user', content: '先来一轮' },
      {
        messageId: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: '上一轮回答' }],
        usage: {
          input: 100,
          output: 200,
          total: 300,
          cacheRead: 0,
          firstTokenMs: 500,
          generationMs: 1400,
          durationMs: 2000,
          provider: 'Test Provider',
          model: 'test-model',
          startedAt: Date.now() - 3000,
          finishedAt: Date.now() - 1000,
        },
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    settings: { reasoning: 'auto' },
    todos: [],
    running: false,
    pending: [],
    undoable: 0,
  })
  await page.goto('/')
  await openDrawer(page)
  await page.getByRole('button', { name: '等待首字', exact: true }).click()

  await mock.emit('wait-stats', [
    { type: 'llm-start', startedAt: Date.now(), provider: 'Test Provider', model: 'test-model' },
  ])
  const stats = page.locator('.session-composer__stats')
  await stats.getByRole('button', { name: /tok\/s/ }).click()
  const liveRow = page.getByRole('dialog', { name: '生成速度' }).locator('.stats-panel__speed-row.is-live')
  await expect(liveRow).toContainText('500ms')
  await expect(liveRow).not.toContainText('—')
  expect(mock.errors).toEqual([])
})

test('streaming does not show a guessed tps before it finishes', async ({ page }) => {
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
  ])
  for (let index = 0; index < 6; index += 1) {
    await mock.emit('live-stats', [{ type: 'text-delta', text: '正在持续输出的内容'.repeat(4) }])
    await page.waitForTimeout(300)
  }
  const stats = page.locator('.session-composer__stats')
  await expect(stats).toBeVisible()
  // 流式还没结束，没有可用的完成样本，不显示任何实时 TPS。
  await expect(stats.getByRole('button', { name: /tok\/s/ })).toHaveCount(0)
  expect(mock.errors).toEqual([])
})
