/*
界面状态审计：逐一保存操作框、上下文浮层、对话跳转条和设置页的真实状态。
测试只使用现有页面动作，不修改服务端数据，截图用于与参考图逐状态比较。
调用方式：bunx playwright test tests/grok-state-audit.spec.js --project=desktop。
*/
import { expect, test } from '@playwright/test'                         // 引入浏览器交互和可见性断言


// --- 保存当前状态截图 ---
async function capture(page, testInfo, name) {
  await page.waitForTimeout(240)                                       // 等待 M3E 动效进入稳定帧
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true }) // 保存完整工作台状态
}


// --- 读取关键组件边界 ---
async function readGeometry(page) {
  return page.evaluate(() => Object.fromEntries([
    ['sidebar', document.querySelector('.sidebar')],                   // 左侧导航边界
    ['composer', document.querySelector('.composer')],                 // 输入胶囊边界
    ['textarea', document.querySelector('.composer textarea')],        // 真实文本输入边界
    ['upload', document.querySelector('.composer__add')],               // 上传文件按钮边界
    ['model', document.querySelector('.model-select')],                 // 模型下拉框边界
    ['send', document.querySelector('.send-command')],                 // 发送按钮边界
  ].map(([name, element]) => [name, element?.getBoundingClientRect().toJSON()]))) // 转换为可附加的纯数据
}


test('designed interaction state screenshots', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop')                       // 参考图以桌面比例为基准
  await page.goto('/')                                                 // 打开真实应用和 Server 数据
  await page.locator('.home-session').first().click()                  // 进入一个可交互会话
  await expect(page.locator('.composer')).toBeVisible()                // 等待 Session 详情完成加载
  await page.waitForTimeout(500)                                       // 等待页面切换动效完全结束

  await capture(page, testInfo, '01-empty')                            // 空输入状态
  await page.locator('.composer textarea').click()                     // 聚焦真实输入区域
  await capture(page, testInfo, '02-focused')                          // 聚焦状态
  await page.locator('.composer textarea').fill('你好')                // 输入参考图单行文本
  await capture(page, testInfo, '03-single-line')                      // 单行文本状态
  await page.locator('.composer textarea').fill('你好\nhi')            // 输入参考图多行文本
  await capture(page, testInfo, '04-multi-line')                       // 多行展开状态

  await expect(page.locator('.model-select')).toBeVisible()             // 模型下拉框必须直接可操作
  await capture(page, testInfo, '05-model-selector')                    // 保存架构规定的模型选择状态

  await page.locator('.context-meter').hover()                         // 触发上下文消耗悬浮反馈
  await expect(page.locator('.context-popover')).toBeVisible()         // 确认悬浮详情真实显示
  await capture(page, testInfo, '06-context-popover')                  // 上下文悬浮状态

  const populatedSession = page.locator('.sidebar__sessions m3e-button').filter({ hasText: 'UI_REAL_OK' }).first() // 查找已有消息的真实会话
  if (await populatedSession.count()) {
    await populatedSession.click()                                    // 切换到有消息的会话
    await expect(page.locator('.message-map')).toBeVisible()           // 等待右侧跳转地图生成
    await page.locator('.message-map').hover()                         // 展示右侧跳转条完整反馈
    await capture(page, testInfo, '07-scroll-map')                     // 对话跳转状态
  }

  await testInfo.attach('geometry', { body: JSON.stringify(await readGeometry(page), null, 2), contentType: 'application/json' }) // 附加尺寸数据
})


test('settings keeps global navigation available', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop')                       // 桌面设置页验证常驻 Grok 侧栏
  await page.goto('/')                                                 // 从主页开始验证完整返回路径
  await page.locator('.sidebar__fifth m3e-button').click()             // 打开设置内容区
  await expect(page.locator('.settings-content')).toBeVisible()        // 设置内容应替换主区域
  await expect(page.locator('.sidebar')).toBeVisible()                 // 全局侧栏必须继续可用
  await expect(page.locator('.settings-rail')).toHaveCount(0)          // 设置内容只保留一层分类侧栏
  await capture(page, testInfo, '08-settings-with-sidebar')            // 保存设置和全局导航共存状态
  await page.locator('.sidebar__second m3e-button').first().click()     // 使用常驻导航返回主页
  await expect(page.locator('.home-view')).toBeVisible()               // 验证用户不被困在设置页
  await capture(page, testInfo, '09-returned-home')                    // 保存真实返回结果
})


test('sidebar lists only sessions opened from home', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop')                     // 桌面展开侧边栏便于直接检查标题列表
  await page.goto('/')                                                  // 新页面运行时尚未打开任何完整会话
  await expect(page.locator('.sidebar-session-item')).toHaveCount(0)    // 工作区历史摘要不能直接进入侧边栏

  const homeSessions = page.locator('.home-session')                    // 主页仍展示当前工作区全部会话
  const firstTitle = (await homeSessions.nth(0).locator('.home-session__main strong').textContent())?.trim() // 记录第一个历史标题
  const secondTitle = (await homeSessions.nth(1).locator('.home-session__main strong').textContent())?.trim() // 记录第二个历史标题
  await homeSessions.nth(0).click()                                     // 点击后从 Server 加载第一个完整会话
  await expect(page.locator('.sidebar-session-item')).toHaveCount(1)    // 只有已加载会话加入侧边栏
  await expect(page.locator('.sidebar-session-item').first()).toContainText(firstTitle) // 第一个打开项显示真实标题

  await page.locator('.sidebar__second m3e-button').first().click()      // 返回主页选择另一个历史会话
  await page.locator('.home-session').nth(1).click()                     // 从 Server 加载第二个完整会话
  await expect(page.locator('.sidebar-session-item')).toHaveCount(2)    // 两个已打开会话组成当前侧边栏列表
  await expect(page.locator('.sidebar-session-item').first()).toContainText(secondTitle) // 最近打开项排在最前
})


test('opened session tabs close without deleting history', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop')                     // 展开侧边栏用于验证标签关闭行为
  await page.goto('/')                                                  // 从全部历史仍可见的主页开始
  const historyCount = await page.locator('.home-session').count()      // 记录关闭标签前的后端历史数量
  await page.locator('.home-session').nth(0).click()                     // 打开第一个标签
  await page.locator('.sidebar__second m3e-button').first().click()      // 回主页继续打开另一个标签
  await page.locator('.home-session').nth(1).click()                     // 第二个标签成为当前对话

  await page.locator('.sidebar-session-item').nth(1).locator('.sidebar-session-close').click() // 最近标签在前，第二项是后台标签
  await expect(page.locator('.chat-view')).toBeVisible()                 // 关闭后台标签时当前对话保持不变
  await expect(page.locator('.sidebar-session-item')).toHaveCount(1)    // 只移除对应打开标签

  await page.locator('.sidebar-session-close').click()                   // 关闭最后一个当前标签
  await expect(page.locator('.home-view')).toBeVisible()                 // 没有相邻标签时返回主页
  await expect(page.locator('.sidebar-session-item')).toHaveCount(0)    // 已打开列表清空
  await expect(page.locator('.home-session')).toHaveCount(historyCount) // 关闭标签不会删除主页历史
})
