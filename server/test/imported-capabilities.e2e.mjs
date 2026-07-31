/*
用户能力浏览器验收：只读检查从 OpenCode 迁移的 MCP 与 Skill，并验证页面开关可交互。
测试不点击保存，因此开关操作只影响当前浏览器草稿，不修改用户真实配置。
运行示例：node test/imported-capabilities.e2e.mjs。
*/
import { chromium } from 'playwright'                                  // 引入真实 Chromium 页面自动化

const browser = await chromium.launch({ headless: true })              // 使用与桌面页面一致的浏览器引擎
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }) // 验证桌面设置布局
const errors = []                                                       // 收集页面运行错误
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) }) // 保存控制台错误
page.on('pageerror', (error) => errors.push(error.message))             // 保存未处理异常

try {
  await page.goto(process.env.AGENT_UI_URL || 'http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' }) // 打开当前真实开发页面
  await page.getByLabel('服务状态').click()                               // 打开顶部运行状态窗
  await page.locator('.capability-popover__item strong', { hasText: 'context7' }).waitFor() // 等待启动时能力快照进入可见弹窗
  const popoverNames = await page.locator('.capability-popover__item strong').allTextContents() // 读取无需进入设置即可看到的具体能力
  await page.screenshot({ path: 'C:\\Users\\17137\\AppData\\Local\\Temp\\opencode\\imported-status.png' }) // 保存顶部具体能力页面
  await page.getByRole('button', { name: '管理 MCP' }).click()             // 从状态窗进入 MCP 设置
  await page.getByRole('heading', { name: 'MCP', exact: true }).waitFor() // 等待真实配置和状态加载
  const mcpNames = await page.locator('.service-row__header strong').allTextContents() // 读取页面展示的迁移服务
  const mcpStatus = await page.locator('.service-row__header').allTextContents() // 读取连接和工具数量
  await page.locator('.service-row__header').first().click()            // 展开第一条服务配置
  const mcpSwitch = page.locator('.service-editor mdui-switch').first() // 定位真实启用开关
  await mcpSwitch.click()                                                // 在未保存草稿中关闭
  const mcpDisabled = !await mcpSwitch.evaluate((element) => element.checked) // 验证控件状态已经改变
  await mcpSwitch.click()                                                // 恢复原启用状态
  await page.screenshot({ path: 'C:\\Users\\17137\\AppData\\Local\\Temp\\opencode\\imported-mcp.png', fullPage: true }) // 保存真实 MCP 页面

  await page.locator('.settings-navigation button').filter({ hasText: '技能' }).click() // 打开独立技能设置
  await page.getByRole('heading', { name: '技能', exact: true }).waitFor() // 等待 Skill 目录加载
  const skillNames = await page.locator('.skill-row strong').allTextContents() // 读取页面展示的迁移技能
  const skillSwitch = page.locator('.skill-row mdui-checkbox').first()   // 定位技能启用开关
  await skillSwitch.click()                                              // 在未保存草稿中禁用
  const skillDisabled = !await skillSwitch.evaluate((element) => element.checked) // 验证控件状态已经改变
  await skillSwitch.click()                                              // 恢复原启用状态
  await page.screenshot({ path: 'C:\\Users\\17137\\AppData\\Local\\Temp\\opencode\\imported-skills.png', fullPage: true }) // 保存真实技能页面

  if (!popoverNames.includes('context7') || !popoverNames.includes('hop') || mcpNames.length !== 4 || !mcpDisabled || !skillNames.includes('hop') || !skillDisabled || errors.length) throw new Error('imported capability UI verification failed') // 任一真实前端条件不满足即失败
  console.log(JSON.stringify({ popoverNames, mcpNames, mcpStatus, skillNames, mcpDisabled, skillDisabled, errors })) // 输出机器可验证摘要
} finally {
  await browser.close()                                                  // 成功或失败均释放浏览器
}
