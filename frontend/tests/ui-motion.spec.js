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
async function watchMotion(page, stableSelectors = []) {
  await page.evaluate(selectors => {
    window.__stopMotion?.()                              // 先停掉上一次采样器，避免旧帧写进新数组
    window.__motion = []
    window.__motionFrames = 0
    const tracked = selectors.map(selector => {
      const node = document.querySelector(selector)
      const { x, y, width, height } = node.getBoundingClientRect()
      return { selector, node, before: { x, y, width, height } }
    })
    const layoutChanges = []
    const seen = new Set()
    let alive = true
    function tick() {
      if (!alive) return                                 // 采样器被停掉后不再申请下一帧
      for (const { selector, node, before } of tracked) {
        const after = node.getBoundingClientRect()
        if (!node.isConnected || Object.keys(before).some(key => Math.abs(before[key] - after[key]) > 0.5)) {
          layoutChanges.push({ selector, connected: node.isConnected, before, after: { x: after.x, y: after.y, width: after.width, height: after.height } })
        }
      }
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
          properties: [...new Set(animation.effect.getKeyframes().flatMap(frame => Object.keys(frame)).filter(key => /^(opacity|transform)$/.test(key)))],
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
      return { list: window.__motion, frames: window.__motionFrames, layoutChanges }
    }
  }, stableSelectors)
}

async function readMotion(page) {
  return page.evaluate(() => window.__stopMotion())
}

// 只挑目标元素上的 opacity/transform 过渡，排除 自有 抽屉等无关动画。
function moving(motion, className) {
  return motion.list.filter(item => item.className.includes(className) && (MOVING.test(item.name) || item.properties.length > 0))
}

// 等采样器真的看到目标动画再停：元素刚挂载时 opacity 还是 0，
// Playwright 的 toBeVisible 会立刻通过，这时停采样会漏掉整段过渡。
async function waitForMotion(page, className) {
  await expect.poll(() => page.evaluate(name => {
    const hit = window.__motion.find(item => item.className.includes(name) && (/^(opacity|transform)$/.test(item.name) || item.properties.length > 0))
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

  test('a pressed option clips its ripple before the next row', async ({ page }, testInfo) => {
    await backend(page)
    await page.goto('/')
    await navigate(page, '设置')
    const row = page.getByRole('button', { name: /模型供应商/ })
    const nextRow = page.locator('.settings-row').filter({ hasText: '默认模型和任务分工' })
    await expect(row).toBeVisible()
    await page.locator('.settings-stack').evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))))
    const before = await nextRow.screenshot({ animations: 'allow' })

    const painted = await row.evaluate(button => {
      const box = button.getBoundingClientRect()
      const x = box.x + box.width / 2
      const y = box.y + box.height / 2
      // 点击图标也必须只给它所属的选项加涟漪；固定在扩散中段检查实际裁剪。
      button.querySelector('svg').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: x, clientY: y }))
      const ripple = button.querySelector('.ui-ripple')
      const animation = ripple.getAnimations()[0]
      animation.pause()
      animation.currentTime = 300
      // 确认动画仍在选项内部显示，不能靠移除涟漪让测试通过。
      ripple.style.pointerEvents = 'auto'
      return {
        attachedToPressedOption: ripple.parentElement === button,
        visibleInside: document.elementFromPoint(x, y) === ripple,
      }
    })
    const during = await nextRow.screenshot({ animations: 'allow' })
    await expect(row.locator('.ui-ripple')).toHaveCount(1)
    await page.screenshot({ path: testInfo.outputPath('option-ripple.png'), animations: 'allow' })
    expect(painted).toEqual({ attachedToPressedOption: true, visibleInside: true })
    expect(during.equals(before), '按下供应商选项后，相邻模型选项的像素不应改变').toBe(true)
  })

  test('pages slide over retained parents without moving their layout', async ({ page }, testInfo) => {
    await backend(page)
    await page.goto('/')
    await navigate(page, '新建对话')
    await send(page, '动效测试')
    await page.locator('.chat-composer').evaluate(element => { element.dataset.retained = 'chat' })

    const chat = ['.rikka-main', '.topbar', '.chat-composer']
    await watchMotion(page, chat)
    await navigate(page, '设置')
    await waitForMotion(page, 'settings-stack')
    await expect(page.locator('.settings-stack')).toHaveCSS('transform', 'none')
    let motion = await readMotion(page)
    const fromRight = item => item.transform.startsWith('matrix(') && Number(item.transform.slice(7, -1).split(',')[4]) > 0
    expect(moving(motion, 'settings-stack').some(fromRight)).toBe(true)
    expect(motion.layoutChanges).toEqual([])
    await expect(page.locator('.rikka-main')).toHaveAttribute('inert', '')

    const home = '.settings-screen[data-page-key="home"]'
    await watchMotion(page, [home, `${home} .settings-topbar`, `${home} .settings-scroll`])
    await page.getByRole('button', { name: /模型供应商/ }).click()
    await expect(page.getByRole('heading', { name: '模型供应商', exact: true, level: 1 })).toBeVisible()
    await waitForMotion(page, 'settings-page-enter-active')
    const providers = '.settings-screen[data-page-key="section:providers"]'
    await expect(page.locator(providers)).toHaveCSS('transform', 'none')
    motion = await readMotion(page)
    expect(moving(motion, 'settings-page-enter-active').some(fromRight)).toBe(true)
    expect(motion.layoutChanges).toEqual([])
    await expect(page.locator(home)).toHaveAttribute('inert', '')
    await page.getByRole('searchbox', { name: '搜索供应商' }).fill('Test')
    await page.locator(`${providers} .provider-list`).evaluate(element => { element.dataset.retained = 'providers' })

    // 详情自己的紧凑页头不能套到仍在下面的列表页面上。
    await watchMotion(page, [providers, `${providers} .settings-topbar`, `${providers} .provider-list`])
    await page.getByRole('button', { name: /Test Provider/ }).click()
    await expect(page.getByRole('textbox', { name: '供应商名' })).toBeVisible()
    await waitForMotion(page, 'settings-page-enter-active')
    await expect(page.locator('.settings-screen--provider')).toHaveCSS('transform', 'none')
    motion = await readMotion(page)
    expect(moving(motion, 'settings-page-enter-active').some(fromRight)).toBe(true)
    expect(motion.layoutChanges).toEqual([])
    await expect(page.locator('.settings-screen')).toHaveCount(3)

    await watchMotion(page, [providers, `${providers} .settings-topbar`, `${providers} .provider-list`])
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await waitForMotion(page, 'settings-page-leave-active')
    await expect(page.locator('.settings-screen--provider')).toHaveCount(0)
    motion = await readMotion(page)
    expect(moving(motion, 'settings-page-leave-active').some(fromRight)).toBe(true)
    expect(motion.layoutChanges).toEqual([])
    await expect(page.getByRole('searchbox', { name: '搜索供应商' })).toHaveValue('Test')
    await expect(page.locator(`${providers} .provider-list`)).toHaveAttribute('data-retained', 'providers')
    await page.screenshot({ path: testInfo.outputPath('retained-provider-list.png'), fullPage: true })

    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(page.locator(providers)).toHaveCount(0)
    await watchMotion(page, chat)
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await waitForMotion(page, 'page-leave-active')
    await expect(page.locator('.settings-stack')).toHaveCount(0)
    motion = await readMotion(page)
    expect(moving(motion, 'settings-stack').some(fromRight)).toBe(true)
    expect(motion.layoutChanges).toEqual([])
    await expect(page.locator('.chat-composer')).toHaveAttribute('data-retained', 'chat')
    await expect(page.locator('.rikka-main')).not.toHaveAttribute('inert', '')
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
    // 虚拟列表只挂载视口附近的轮次；滚动时挂载集合变化是预期行为。
    await expect(page.locator('.rikka-bubble--user').last()).toContainText('第 22 条问题。')
    await expect(page.locator('.conversation-earlier')).toHaveCount(0)
    await expect.poll(() => page.locator('.session-scroll').evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(4)
    const rendered = await page.locator('.message').count()
    expect(rendered).toBeGreaterThan(2)
    await expect(page.locator('.conversation-flow')).not.toHaveClass(/session-swap-enter-active/)
    const scrollable = await page.locator('.session-scroll').evaluate(element => element.scrollHeight > element.clientHeight)
    expect(scrollable).toBe(true)
    const beforeScroll = await page.locator('.session-scroll').evaluate(element => ({ top: element.scrollTop, height: element.scrollHeight }))
    await page.locator('.session-scroll').hover()
    await page.mouse.wheel(0, -10000)
    await expect.poll(() => page.locator('.session-scroll').evaluate(element => element.scrollTop)).toBeLessThan(beforeScroll.top)
    const latest = page.getByRole('button', { name: '回到最新', exact: true })
    await expect(latest).toBeVisible()
    await latest.click()
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

    // 输入框在 ChatView 里，不跟着 Timeline 重建；同时只能有一套聊天内容。
    await expect(page.locator('.chat-composer')).toHaveCount(1)
    await expect(page.locator('.conversation-flow')).toHaveCount(1)
    expect(await page.locator('.chat-composer').getAttribute('data-motion-keep')).toBe('yes')

    await openSession(page, '会话甲')
    await expect(page.locator('.rikka-bubble--user').last()).toContainText('第 22 条问题。')
    await expect.poll(() => page.locator('.session-scroll').evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(4)
    expect(await page.locator('.chat-composer').getAttribute('data-motion-keep')).toBe('yes')
    expect(mock.errors).toEqual([])
  })

  test('todo drawer slides in', async ({ page }) => {
    const mock = await backend(page)
    await page.goto('/')
    await newSession(page, '面板动效')

    await navigate(page, '新建对话')
    await page.getByRole('textbox', { name: '消息', exact: true }).fill('keep running')
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    await expect(page.getByText('正在处理', { exact: true })).toBeVisible()
    await mock.emit('session-2', [
      { type: 'agent-start' },
      { type: 'tool-call', toolCallId: 'todo-motion', toolName: 'update_todo_list', input: { todos: '- [ ] 动效任务' } },
      { type: 'tool-result', toolCallId: 'todo-motion', toolName: 'update_todo_list', output: { type: 'json', value: { items: [{ text: '动效任务', status: 'pending' }] } } },
    ])
    // 清单不再占输入框上方；打开右侧面板时走 自有 抽屉动画。
    await expect(page.locator('.session-todos')).toHaveCount(0)
    await watchMotion(page)
    await page.getByRole('button', { name: '任务清单', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '任务清单' })).toBeVisible()
    await waitForMotion(page, 'ui-dialog__panel')
    const motion = await readMotion(page)
    expect(moving(motion, 'ui-dialog__panel').length, JSON.stringify(motion.list)).toBeGreaterThan(0)
    expect(moving(motion, 'ui-dialog__panel').some(item => item.duration > 0)).toBe(true)
    expect(mock.errors).toEqual([])
  })

  test('settings switches use the same local thumb motion', async ({ page }) => {
    await backend(page)
    await page.goto('/')
    await navigate(page, '设置')
    await page.getByRole('button', { name: /通用/ }).click()
    const toggle = page.getByRole('switch', { name: '增强键盘焦点' })
    const thumb = page.locator('.appearance-card .ui-switch', { hasText: '增强键盘焦点' }).locator('.ui-switch__thumb')
    await expect(toggle).not.toBeChecked()

    const duration = await thumb.evaluate(element => getComputedStyle(element).transitionDuration)
    expect(duration).not.toBe('0s')

    await toggle.scrollIntoViewIfNeeded()
    const before = await thumb.boundingBox()
    await page.mouse.click(before.x + before.width / 2, before.y + before.height / 2)
    await expect(toggle).toBeChecked()
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

  test('message action layer animates', async ({ page }) => {
    await backend(page)
    await page.goto('/')
    await newSession(page, '操作层动效')

    await watchMotion(page)
    await page.locator('.rikka-bubble--user').first().click({ button: 'right' })
    // 右键直接打开聚光引导；引导层和卡片进入时都要真的动。
    const actions = page.getByRole('dialog', { name: '消息操作', exact: true })
    await expect(actions).toBeVisible()
    await waitForMotion(page, 'rollback-spotlight__card')
    const motion = await readMotion(page)
    const card = moving(motion, 'rollback-spotlight__card')
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
