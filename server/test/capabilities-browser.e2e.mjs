/*
能力中心浏览器 E2E：通过真实页面配置 MCP/LSP，检查 Skill 发现、动态工具和响应式布局。
运行前需要启动隔离 Server 和 Vite；CAPABILITY_UI_URL 可覆盖默认测试地址。
*/
import { chromium } from 'playwright'                                   // 引入真实 Chromium 浏览器自动化

const browser = await chromium.launch({ headless: true })               // 使用与用户页面相同的浏览器引擎
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }) // 首先验证桌面工作区
const errors = []                                                        // 收集页面脚本和控制台错误
page.setDefaultTimeout(12000)                                            // 交互失败快速定位而不是长期挂起
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) }) // 保存真实控制台错误
page.on('pageerror', (error) => errors.push(error.message))              // 保存未处理页面异常


// --- 修改一个 MDUI 输入字段 ---
async function setField(label, value) {
  const field = page.locator(`mdui-text-field[label="${label}"]`).last() // 当前分类内按标签定位输入
  await field.evaluate((element, nextValue) => {
    element.value = nextValue                                           // 修改 Web Component 公开值
    element.dispatchEvent(new Event('input', { bubbles: true }))         // 触发 Vue 草稿更新
    element.dispatchEvent(new Event('change', { bubbles: true }))        // 同步提交型字段
  }, value)
}


try {
  const uiURL = process.env.CAPABILITY_UI_URL || 'http://127.0.0.1:5175' // 复用当前隔离前端地址
  await page.request.put(`${uiURL}/api/config`, { data: { mcpServers: {}, lspServers: {} } }) // 清除上次运行的隔离服务声明
  await page.request.post(`${uiURL}/api/capability/reload`)              // 关闭旧测试进程并刷新运行目录
  await page.goto(uiURL, { waitUntil: 'domcontentloaded' })              // 打开真实 Vite 页面
  await page.getByLabel('能力状态').click()                               // 打开 OpenCode 式顶部状态小窗
  await page.getByLabel('运行能力').waitFor()                             // 等待共享能力快照加载
  await page.getByRole('button', { name: '打开能力设置' }).click()        // 从小窗深链到全局设置
  await page.getByRole('heading', { name: '扩展能力' }).waitFor()         // 等待 Cherry Studio 式设置分类
  await page.getByRole('tab', { name: 'MCP' }).click()                    // 切换到 MCP 管理
  await page.getByRole('button', { name: '添加服务' }).click()            // 通过 UI 创建声明
  await page.locator('.service-row__header').click()                      // 展开结构化编辑器
  await setField('命令', process.execPath)                                // 使用当前 Node 启动真实夹具
  await setField('参数（每行一个）', 'D:\\kernyr\\agent\\server\\test\\fixtures\\mcp-server.js') // 每行一个安全参数
  await page.locator('mdui-button-icon[aria-label="添加环境变量"]').click() // 覆盖高级键值编辑器
  await page.locator('input[aria-label="键名"]').fill('CAPABILITY_E2E')   // 设置真实子进程环境变量名
  await page.locator('input[aria-label="值"]').fill('enabled')            // 设置真实子进程环境变量值
  await page.getByRole('tab', { name: 'LSP' }).click()                    // 切换到 LSP 管理
  await page.getByRole('button', { name: '添加服务' }).click()            // 通过 UI 创建语言服务器
  await page.locator('.service-row__header').click()                      // 展开 LSP 编辑器
  await setField('命令', process.execPath)                                // 使用当前 Node 启动真实夹具
  await setField('语言 ID', 'javascript')                                // 声明标准语言 ID
  await setField('工作区根目录', 'D:\\kernyr\\agent')                 // 指向真实项目根目录
  await setField('文件扩展名（逗号分隔）', 'js')                          // 建立文件到服务映射
  await setField('参数（每行一个）', 'D:\\kernyr\\agent\\server\\test\\fixtures\\lsp-server.js') // 设置真实服务脚本
  await page.getByRole('button', { name: '保存并应用' }).click()           // 触发配置持久化和连接重建
  await page.getByText('配置已保存，运行能力已更新').waitFor({ timeout: 20000 }) // 等待两个服务完成握手

  await page.getByRole('tab', { name: 'MCP' }).click()                    // 检查 MCP 状态反馈
  const mcpText = await page.locator('.service-row__header').innerText()  // 读取连接与工具数量
  await page.getByRole('tab', { name: 'LSP' }).click()                    // 检查 LSP 状态反馈
  const lspText = await page.locator('.service-row__header').innerText()  // 读取语言服务器状态
  await page.getByRole('tab', { name: 'Skills' }).click()                 // 检查渐进披露目录
  const skillVisible = await page.getByText('browser-skill', { exact: true }).isVisible() // 默认用户目录 Skill 应可见
  await page.getByRole('tab', { name: '工具' }).click()                   // 回到统一工具注册表
  const dynamicTools = await page.locator('.tool-row').evaluateAll((rows) => rows.map((row) => row.innerText).filter((text) => /mcp_mcp-1_echo-value|lsp_diagnostics|load_skill/.test(text))) // 三类动态工具都应可检查
  await page.screenshot({ path: 'C:\\Users\\17137\\AppData\\Local\\Temp\\opencode\\capabilities-desktop.png', fullPage: true }) // 保存桌面视觉证据
  const desktop = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, tabs: document.querySelectorAll('.capability-tabs button').length, toolRows: document.querySelectorAll('.tool-row').length })) // 检查桌面结构和溢出
  await page.reload({ waitUntil: 'domcontentloaded' })                    // 重建页面以验证顶部入口独立可达
  await page.getByLabel('能力状态').click()                               // 打开同步最终状态的顶部小窗
  await page.getByLabel('运行能力').waitFor({ state: 'visible' })          // 截图前必须确认真实弹层可见
  const popoverText = await page.getByLabel('运行能力').innerText()       // 读取三个能力分类的连接统计
  await page.waitForTimeout(250)                                          // 等待 MDUI 定位动画完成后采集视觉证据
  await page.screenshot({ path: 'C:\\Users\\17137\\AppData\\Local\\Temp\\opencode\\capabilities-popover.png' }) // 保存顶部小窗视觉证据
  await page.getByRole('button', { name: '打开能力设置' }).click()        // 从独立小窗再次进入设置
  await page.getByRole('heading', { name: '扩展能力' }).waitFor()         // 确认深链恢复能力分类
  await page.setViewportSize({ width: 390, height: 844 })                  // 切换真实移动视口
  await page.getByRole('tab', { name: 'MCP' }).click()                    // 验证服务行移动布局
  await page.screenshot({ path: 'C:\\Users\\17137\\AppData\\Local\\Temp\\opencode\\capabilities-mobile.png', fullPage: true }) // 保存移动视觉证据
  const mobile = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, serviceRows: document.querySelectorAll('.service-row__header').length })) // 检查移动横向溢出
  console.log(JSON.stringify({ mcpText, lspText, skillVisible, dynamicTools: dynamicTools.length, popoverText, desktop, mobile, errors })) // 输出机器可验证摘要
} finally {
  await browser.close()                                                   // 成功或失败均释放浏览器进程
}
