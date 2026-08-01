/*
Grok 状态审计：逐一保存输入框、模型菜单、上下文浮层和对话跳转条的真实交互状态。
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
    ['model', document.querySelector('.model-trigger')],               // 模型胶囊边界
    ['voice', document.querySelector('.composer__voice')],             // 语音按钮边界
    ['send', document.querySelector('.send-command')],                 // 发送按钮边界
  ].map(([name, element]) => [name, element?.getBoundingClientRect().toJSON()]))) // 转换为可附加的纯数据
}


test('grok interaction state screenshots', async ({ page }, testInfo) => {
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

  await page.locator('.model-trigger').click()                         // 打开 M3E 模型菜单
  await expect(page.locator('.model-menu')).toBeVisible()              // 确认浮层真实打开
  await capture(page, testInfo, '05-model-menu')                       // 模型菜单展开状态
  await page.keyboard.press('Escape')                                  // 关闭菜单释放后续交互

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
