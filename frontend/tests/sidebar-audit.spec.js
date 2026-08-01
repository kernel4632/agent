/*
侧栏专项审计：验证展开、收起、再次展开三个状态下的可见规则、图标坐标和点击命中。
测试只操作导航和无副作用页面动作，并把桌面、移动状态截图写入 Playwright 测试输出目录。
调用方式：bunx playwright test tests/sidebar-audit.spec.js。
*/
import { expect, test } from '@playwright/test'                         // 引入浏览器断言与测试生命周期


// --- 读取侧栏几何状态 ---
async function readSidebarState(page) {
  return page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar')                     // 读取真实侧栏外框
    const box = sidebar?.getBoundingClientRect()                            // 记录侧栏在当前视口的几何边界
    const visible = (element) => {
      const style = getComputedStyle(element)                              // 检查元素是否真实参与布局
      const rect = element.getBoundingClientRect()                          // 检查元素是否有稳定尺寸
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const buttons = [...document.querySelectorAll('.sidebar m3e-icon-button, .sidebar__second m3e-button, .sidebar__fifth m3e-button')].filter(visible).map((element) => {
      const rect = element.getBoundingClientRect()                          // 保存每个命令控件位置
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } // 计算点击中心
      const hit = document.elementFromPoint(center.x, center.y)              // 验证控件中心没有被遮罩覆盖
      return { label: element.getAttribute('aria-label') || element.getAttribute('title') || '', left: rect.left, top: rect.top, width: rect.width, height: rect.height, hitInside: hit === element || element.contains(hit) }
    })
    return { className: sidebar?.className || '', left: box?.left, top: box?.top, right: box?.right, bottom: box?.bottom, width: box?.width, height: box?.height, buttons }
  })
}


// --- 断言侧栏命令控件均可点击 ---
async function expectClickableSidebar(page, state) {
  expect(state.buttons.length).toBeGreaterThan(0)                              // 当前状态必须有至少一个导航命令
  expect(state.buttons.every((button) => button.width >= 38 && button.height >= 38)).toBe(true) // 图标命令保持稳定触控尺寸
  expect(state.buttons.every((button) => button.hitInside)).toBe(true)          // 中心点必须命中自身而不是遮罩
  for (const label of state.buttons.map((button) => button.label).filter(Boolean)) {
    await expect(page.locator('.sidebar').locator(`[aria-label="${label}"], [title="${label}"]`).first()).toBeVisible() // 每个带标签命令必须可见
  }
}


// --- 验证一个视口下的完整展开收起循环 ---
async function auditViewport(page, testInfo, name) {
  await page.goto('/')                                                           // 通过真实 Vite 页面和代理加载工作台
  await expect(page.locator('.app-status')).toHaveCount(0, { timeout: 15_000 }) // 等待真实 Server 数据完成

  let state = await readSidebarState(page)                                      // 读取首次状态
  const initiallyOpen = state.className.includes('sidebar--open')               // 移动端允许首次收起，桌面端默认展开
  if (initiallyOpen) {
    await expect(page.locator('.sidebar__first m3e-icon-button[aria-label="收起侧边栏"]')).toBeVisible() // 展开态只能显示收起按钮
    await expect(page.locator('.sidebar__fourth m3e-icon-button[aria-label="展开侧边栏"]')).toHaveCount(0) // 展开按钮在展开态必须隐藏
  } else {
    await expect(page.locator('.sidebar__fourth m3e-icon-button[aria-label="展开侧边栏"]')).toBeVisible() // 收起态必须显示展开按钮
    await expect(page.locator('.sidebar__first m3e-icon-button[aria-label="收起侧边栏"]')).toHaveCount(0) // 收起按钮在收起态必须隐藏
  }
  await expectClickableSidebar(page, state)                                     // 首次状态控件位置和命中检查
  await page.screenshot({ path: testInfo.outputPath(`${name}-initial.png`), fullPage: true }) // 保存初始状态截图

  if (!initiallyOpen) await page.locator('.sidebar__fourth m3e-icon-button[aria-label="展开侧边栏"]').click() // 收起初始态先展开
  state = await readSidebarState(page)                                          // 读取展开后的真实坐标
  expect(state.className).toContain('sidebar--open')                            // 展开动作必须改变状态类
  await expect(page.locator('.sidebar__first m3e-icon-button[aria-label="收起侧边栏"]')).toBeVisible() // 展开态收起控件可见
  await expect(page.locator('.sidebar__third')).toBeVisible()                    // 展开态会话列表可见
  await expectClickableSidebar(page, state)                                     // 展开态所有图标位置和中心命中
  await page.screenshot({ path: testInfo.outputPath(`${name}-open.png`), fullPage: true }) // 保存展开状态截图

  const openWidth = state.width                                                     // 保存展开宽度用于收起对比
  await page.locator('.sidebar__first m3e-icon-button[aria-label="收起侧边栏"]').click() // 执行真正收起动作
  state = await readSidebarState(page)                                          // 读取收起后的真实坐标
  expect(state.className).not.toContain('sidebar--open')                        // 收起动作必须移除状态类
  if (page.viewportSize().width > 760) expect(state.width).toBeLessThan(openWidth) // 桌面收起态必须真实变窄
  else expect(state.height).toBeLessThan(100)                                     // 移动收起态改为底部固定图标栏，高度必须稳定
  await expect(page.locator('.sidebar__fourth m3e-icon-button[aria-label="展开侧边栏"]')).toBeVisible() // 收起态展开控件可见
  await expect(page.locator('.sidebar__third')).toHaveCount(0)                  // 收起态会话列表不应占据布局
  await expectClickableSidebar(page, state)                                     // 收起态图标仍保持可见、居中和可命中
  await page.screenshot({ path: testInfo.outputPath(`${name}-collapsed.png`), fullPage: true }) // 保存收起状态截图

  await page.locator('.sidebar__fourth m3e-icon-button[aria-label="展开侧边栏"]').click() // 再次展开验证状态可逆
  state = await readSidebarState(page)                                          // 读取第二次展开坐标
  expect(state.className).toContain('sidebar--open')                            // 状态循环必须回到展开
  await expectClickableSidebar(page, state)                                     // 第二次展开仍无图标偏移或遮挡
  await page.screenshot({ path: testInfo.outputPath(`${name}-reopened.png`), fullPage: true }) // 保存再次展开截图
}


test('desktop sidebar geometry and reversible controls', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop')                              // 桌面项目只运行桌面专项
  await auditViewport(page, testInfo, 'sidebar-desktop')                      // 执行桌面展开收起循环
})


test('mobile sidebar geometry and reversible controls', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile')                               // 移动项目只运行移动专项
  await auditViewport(page, testInfo, 'sidebar-mobile')                       // 执行移动展开收起循环
})
