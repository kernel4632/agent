/*
界面动效回归：证明页面切换、会话切换和输入区面板在允许动效时真的在动，
并且在系统开启“减少动态效果”时按无障碍要求停掉。
和 ui-audit.spec.js 共用 chat-fixture.js 的接口 mock。
运行：bun run test:ui
*/
import { expect, test } from '@playwright/test'
import { backend, navigate, openDrawer } from './chat-fixture.js'

const MOVING = /^(opacity|transform)$/

// 在页面里逐帧采样 document.getAnimations()：只留真正处于 running 的过渡/动画。
// 采样式探针不会因为断言慢半拍而漏掉 200ms 的切换动画。
async function watchMotion(page) {
  await page.evaluate(() => {
    window.__stopMotion?.()                              // 先停掉上一次采样器，避免旧帧写进新数组
    window.__motion = []
    window.__motionFrames = 0
    const seen = new Set()
    let alive = true
    function tick() {
      if (!alive) return                                 // 采样器被停掉后不再申请下一帧
      let active = false
      for (const animation of document.getAnimations()) {
        if (animation.playState !== 'running') continue
        const target = animation.effect?.target
        if (!(target instanceof Element)) continue
        active = true
        const timing = animation.effect.getTiming()
        const name = animation.transitionProperty || animation.animationName || ''
        const className = String(target.className || '')
        const key = `${name}|${className}`
        if (seen.has(key)) continue
        seen.add(key)
        window.__motion.push({
          name,
          duration: Number(timing.duration) || 0,
          className,
          tag: target.tagName,
          opacity: getComputedStyle(target).opacity,
          transform: getComputedStyle(target).transform,
        })
      }
      if (active) window.__motionFrames += 1
      requestAnimationFrame(tick)
    }
    tick()
    window.__stopMotion = () => {
      alive = false
      return { list: window.__motion, frames: window.__motionFrames }
    }
  })
}

async function readMotion(page) {
  return page.evaluate(() => window.__stopMotion())
}

// 只挑目标元素上的 opacity/transform 过渡，排除 KIMA 抽屉等无关动画。
function moving(motion, className) {
  return motion.list.filter(item => item.className.includes(className) && MOVING.test(item.name))
}

// 等采样器真的看到目标动画再停：元素刚挂载时 opacity 还是 0，
// Playwright 的 toBeVisible 会立刻通过，这时停采样会漏掉整段过渡。
async function waitForMotion(page, className) {
  await expect.poll(() => page.evaluate(name => {
    const hit = window.__motion.find(item => item.className.includes(name) && /^(opacity|transform)$/.test(item.name))
    return hit ? `${hit.name}:${hit.duration}` : ''
  }, className), { message: `${className} 没有产生 opacity/transform 动画` }).not.toBe('')
}

async function send(page, text) {
  await page.getByRole('textbox', { name: '消息', exact: true }).fill(text)
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.rikka-bubble--assistant .markdown-body')).toContainText('一步步实现')
}

async function newSession(page, text) {
  await navigate(page, '新建对话')
  await send(page, text)
}

async function openSession(page, title) {
  await openDrawer(page)
  await page.getByRole('dialog', { name: '项目与会话' }).getByRole('button', { name: title, exact: true }).first().click()
}

test.describe('chat motion', () => {
  test.use({ reducedMotion: 'no-preference' })

  test('draft, session and settings switches run opacity and transform transitions', async ({ page }) => {
    await backend(page)
    await page.goto('/')
    await navigate(page, '新建对话')

    await watchMotion(page)
    await send(page, '动效测试')
    await expect(page.locator('.session-panel')).toBeVisible()
    await waitForMotion(page, 'session-panel')
    let motion = await readMotion(page)
    const sessionEnter = moving(motion, 'session-panel')
    expect(motion.frames, JSON.stringify(motion.list)).toBeGreaterThan(0)
    expect(sessionEnter.length, JSON.stringify(motion.list)).toBeGreaterThan(0)
    expect(sessionEnter.some(item => item.opacity !== '1' || item.transform !== 'none')).toBe(true)
    expect(sessionEnter.some(item => item.duration >= 200 && item.duration <= 240)).toBe(true)

    await page.waitForTimeout(400)
    await watchMotion(page)
    await navigate(page, '设置')
    await expect(page.getByRole('heading', { name: '设置', exact: true, level: 1 })).toBeVisible()
    await waitForMotion(page, 'settings-screen')
    motion = await readMotion(page)
    const settingsEnter = moving(motion, 'settings-screen')
    expect(settingsEnter.length, JSON.stringify(motion.list)).toBeGreaterThan(0)
    expect(settingsEnter.some(item => item.duration >= 200 && item.duration <= 240)).toBe(true)

    // 供应商页是多根组件；这里专门盯它，防止再次退化成没有过渡。
    await page.waitForTimeout(400)
    await watchMotion(page)
    await page.getByRole('button', { name: /模型供应商/ }).click()
    await expect(page.getByRole('textbox', { name: '供应商名' })).toBeVisible()
    await waitForMotion(page, 'settings-detail')
    motion = await readMotion(page)
    expect(moving(motion, 'settings-detail').length, JSON.stringify(motion.list)).toBeGreaterThan(0)
  })

  test('switching sessions animates the timeline and keeps one composer', async ({ page }) => {
    const mock = await backend(page)
    await page.goto('/')
    await newSession(page, '第一个会话的问题')
    await newSession(page, '第二个会话的问题')

    // 第一条会话塞满历史，返回时才能验证滚动仍然贴底。
    const first = mock.sessions.get('session-1')
    for (let index = 0; index < 24; index += 1) {
      first.history.push({ messageId: `seed-${index}`, role: index % 2 ? 'assistant' : 'user', content: index % 2 ? `第 ${index} 条回复。` : `第 ${index} 条问题。` })
    }
    first.title = '会话甲'
    mock.sessions.get('session-2').title = '会话乙'
    await page.reload()

    await openSession(page, '会话甲')
    await expect(page.locator('.rikka-bubble--user').first()).toContainText('第一个会话的问题')
    await expect.poll(() => page.locator('.session-scroll').evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(4)
    await page.evaluate(() => { document.querySelector('.chat-composer').dataset.motionKeep = 'yes' })

    await watchMotion(page)
    await openSession(page, '会话乙')
    await expect(page.locator('.rikka-bubble--user').first()).toContainText('第二个会话的问题')
    await waitForMotion(page, 'session-swap-enter')
    const motion = await readMotion(page)
    const timelineEnter = moving(motion, 'session-swap-enter')
    expect(timelineEnter.length, JSON.stringify(motion.list)).toBeGreaterThan(0)
    expect(timelineEnter.some(item => item.opacity !== '1' || item.transform !== 'none')).toBe(true)
    expect(timelineEnter.some(item => item.duration >= 200 && item.duration <= 240)).toBe(true)

    // 输入框在 SessionView 里，不跟着 Timeline 重建；同时只能有一套聊天内容。
    await expect(page.locator('.chat-composer')).toHaveCount(1)
    await expect(page.locator('.conversation-flow')).toHaveCount(1)
    expect(await page.locator('.chat-composer').getAttribute('data-motion-keep')).toBe('yes')

    await openSession(page, '会话甲')
    await expect(page.locator('.rikka-bubble--user').first()).toContainText('第一个会话的问题')
    await expect.poll(() => page.locator('.session-scroll').evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(4)
    expect(await page.locator('.chat-composer').getAttribute('data-motion-keep')).toBe('yes')
    expect(mock.errors).toEqual([])
  })

  test('more panel and todo drawer slide in', async ({ page }) => {
    const mock = await backend(page)
    await page.goto('/')
    await newSession(page, '面板动效')

    await page.getByRole('button', { name: '更多选项', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '更多选项' })).toBeVisible()
    await watchMotion(page)
    await page.getByRole('button', { name: '对话设置', exact: true }).click()
    await expect(page.locator('.chat-more')).toBeVisible()
    await waitForMotion(page, 'chat-more')
    let motion = await readMotion(page)
    expect(moving(motion, 'chat-more').length, JSON.stringify(motion.list)).toBeGreaterThan(0)
    expect(moving(motion, 'chat-more').some(item => item.duration >= 200 && item.duration <= 240)).toBe(true)

    await page.getByRole('button', { name: '更多选项', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '更多选项' })).toBeVisible()
    await page.getByRole('button', { name: '对话设置', exact: true }).click()
    await expect(page.locator('.chat-more')).toHaveCount(0)

    await navigate(page, '新建对话')
    await page.getByRole('textbox', { name: '消息', exact: true }).fill('keep running')
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    await expect(page.getByRole('button', { name: '停止生成', exact: true })).toBeVisible()
    await mock.emit('session-2', [
      { type: 'agent-start' },
      { type: 'tool-call', toolCallId: 'todo-motion', toolName: 'update_todo_list', input: { todos: '- [ ] 动效任务' } },
      { type: 'tool-result', toolCallId: 'todo-motion', toolName: 'update_todo_list', output: { type: 'json', value: { items: [{ text: '动效任务', status: 'pending' }] } } },
    ])
    // 清单不再占输入框上方；打开右侧面板时走 KIMA 抽屉动画。
    await expect(page.locator('.session-todos')).toHaveCount(0)
    await watchMotion(page)
    await page.getByRole('button', { name: '任务清单', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '任务清单' })).toBeVisible()
    await waitForMotion(page, 'kima-drawer__panel')
    motion = await readMotion(page)
    expect(moving(motion, 'kima-drawer__panel').length, JSON.stringify(motion.list)).toBeGreaterThan(0)
    expect(moving(motion, 'kima-drawer__panel').some(item => item.duration > 0)).toBe(true)
    expect(mock.errors).toEqual([])
  })

  test('tool switches use the same KIMA thumb motion', async ({ page }) => {
    await backend(page)
    await page.goto('/')
    await navigate(page, '设置')
    await page.getByRole('button', { name: /工具管理/ }).click()
    const toggle = page.getByRole('switch', { name: '切换 read_file' })
    const thumb = page.locator('.settings-row', { hasText: 'read_file' }).locator('.kima-switch__thumb')
    await expect(toggle).toBeChecked()

    const duration = await thumb.evaluate(element => getComputedStyle(element).transitionDuration)
    expect(duration).not.toBe('0s')

    const before = await thumb.boundingBox()
    await page.mouse.click(before.x + before.width / 2, before.y + before.height / 2)
    await expect(toggle).not.toBeChecked()
    await expect.poll(async () => (await thumb.boundingBox()).x).not.toBeCloseTo(before.x, 1)
  })

  test('composer fullscreen keeps a height transition', async ({ page }) => {
    await backend(page)
    await page.goto('/')
    await navigate(page, '新建对话')
    const editor = page.getByRole('textbox', { name: '消息', exact: true })
    const transition = await editor.evaluate(element => ({
      property: getComputedStyle(element).transitionProperty,
      duration: getComputedStyle(element).transitionDuration,
    }))
    expect(transition.property).toContain('min-height')
    expect(transition.duration).not.toBe('0s')

    await page.locator('.chat-composer__expand-corner').hover()
    await page.getByRole('button', { name: '全屏输入', exact: true }).click()
    await expect(page.locator('.chat-composer')).toHaveClass(/is-expanded/)
    const running = await editor.evaluate(element => element.getAnimations().some(animation => animation.transitionProperty === 'min-height' && animation.playState === 'running'))
    expect(running).toBe(true) // 真的在过渡高度，而不是只写了 CSS
  })

  test('slash menu and message action layer animate', async ({ page }) => {
    await backend(page)
    await page.goto('/')
    await newSession(page, '操作层动效')

    await watchMotion(page)
    await page.getByRole('textbox', { name: '消息', exact: true }).fill('/')
    await expect(page.getByRole('option', { name: /review/ })).toBeVisible()
    await waitForMotion(page, 'chat-composer__slash')
    let motion = await readMotion(page)
    expect(moving(motion, 'chat-composer__slash').length, JSON.stringify(motion.list)).toBeGreaterThan(0)

    await page.keyboard.press('Escape')
    await expect(page.getByRole('option', { name: /review/ })).toHaveCount(0)
    await watchMotion(page)
    await page.locator('.rikka-bubble--user').first().click({ button: 'right' })
    const actions = page.getByRole('dialog', { name: '消息操作', exact: true })
    await expect(actions).toBeVisible()
    await waitForMotion(page, 'message-actions')
    motion = await readMotion(page)
    const card = moving(motion, 'message-actions__card')
    expect(card.length, JSON.stringify(motion.list)).toBeGreaterThan(0)
    expect(card.some(item => item.opacity !== '1' || item.transform !== 'none')).toBe(true)
    expect(card.some(item => item.duration >= 200 && item.duration <= 240)).toBe(true)
  })
})

test.describe('reduced motion', () => {
  test('the same chat switch is effectively instant', async ({ page }) => {
    // 直接按系统偏好模拟，避免同一文件里前后两个 describe 的媒体设置互相影响。
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await backend(page)
    await page.goto('/')
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)

    await navigate(page, '新建对话')
    await watchMotion(page)
    await send(page, '减少动效')
    await expect(page.locator('.session-panel')).toBeVisible()
    await page.waitForTimeout(400)
    const motion = await readMotion(page)

    // 系统要求减少动效时，切换过渡只允许 <= 1ms（base.scss 统一压到 .01ms）。
    expect(moving(motion, 'session-panel').filter(item => item.duration > 1), JSON.stringify(motion.list)).toEqual([])
    const style = await page.locator('.message').first().evaluate(element => ({
      animation: getComputedStyle(element).animationName,
    }))
    expect(style.animation).toBe('none')
    const sendTransitions = await page.locator('.chat-composer__send').evaluate(element => getComputedStyle(element).transitionDuration)
    const durations = sendTransitions.split(',').map(value => {
      const text = value.trim()
      return text.endsWith('ms') ? Number.parseFloat(text) : Number.parseFloat(text) * 1000
    })
    expect(Math.max(...durations), sendTransitions).toBeLessThanOrEqual(1)
  })
})
