/*
宣传网站浏览器检查：在 Playwright 官方支持的 Node 运行时启动 Chromium，验证桌面、移动和交互效果。
脚本只读取传入 URL，并把截图写入传入目录；成功时向标准输出返回单个 JSON 结果。
调用示例：node test/browser-check.mjs http://127.0.0.1:3000/ ./test-output。
*/
import { join } from 'node:path'                  // 引入桌面与移动截图路径拼接能力
import { chromium } from 'playwright'             // 引入真实 Chromium 自动化能力

const [websiteURL, outputDirectory] = process.argv.slice(2) // 从监督测试器读取网站地址与截图目录
if (!websiteURL || !outputDirectory) throw new Error('website URL and output directory are required') // 缺少目标时拒绝空跑


// --- 检查页面运行错误 ---
function collectErrors(page, errors) {
  page.on('console', (message) => {                // 监听页面控制台输出
    if (message.type() === 'error') errors.push(message.text()) // 只把真实错误加入失败依据
  })
  page.on('pageerror', (error) => errors.push(error.message)) // 收集未捕获 JavaScript 异常
}


// --- 滚动触发页面渐入内容 ---
async function revealPage(page) {
  await page.evaluate(async () => {                         // 在真实页面中模拟用户逐段向下浏览
    const previousBehavior = document.documentElement.style.scrollBehavior // 保存页面原有滚动设置
    document.documentElement.style.scrollBehavior = 'auto'         // 避免平滑滚动动画吞掉连续测试位置
    for (let position = 0; position < document.body.scrollHeight; position += 300) {
      window.scrollTo(0, position)                          // 让 IntersectionObserver 依次看到每个区域
      await new Promise((resolve) => setTimeout(resolve, 80)) // 给动画和观察器处理当前视口
    }
    window.scrollTo(0, document.body.scrollHeight)          // 明确触发页面最底部区域
    await new Promise((resolve) => setTimeout(resolve, 120)) // 等待最后一个观察器回调
    window.scrollTo(0, 0)                                  // 截图前回到页面顶部
    document.documentElement.style.scrollBehavior = previousBehavior // 恢复页面自身滚动体验
  })
  await page.waitForTimeout(700)                            // 等待最后一批渐入动画完成
  const hiddenContent = await page.locator('.feature-card, .step, .mode-card').evaluateAll((elements) => elements.filter((element) => Number.parseFloat(getComputedStyle(element).opacity) < 0.5).length) // 统计仍不可见的核心内容
  if (hiddenContent > 0) throw new Error(`${hiddenContent} core content blocks remain hidden after scrolling`) // 核心内容不能长期隐藏
}


// --- 执行桌面与移动浏览器检查 ---
const browser = await chromium.launch({ headless: true }) // 启动 Playwright 管理的无头 Chromium
try {
  const errors = []                                      // 合并两个视口的全部运行错误
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } }) // 创建常见桌面视口
  collectErrors(desktop, errors)                         // 开始收集桌面运行错误
  await desktop.goto(websiteURL, { waitUntil: 'networkidle' }) // 通过真实 HTTP 加载完整页面资源
  await desktop.waitForTimeout(1000)                     // 等待首屏动画和脚本完成初始化
  const desktopOverflow = await desktop.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth) // 检查横向溢出
  if (desktopOverflow) throw new Error('desktop page has horizontal overflow') // 桌面布局不得超出视口
  const bodyTextBefore = await desktop.locator('body').textContent() // 保存交互前可见页面文本
  const scrollBefore = await desktop.evaluate(() => window.scrollY) // 保存交互前页面滚动位置
  let dialogWasShown = false                               // 记录 CTA 是否通过浏览器对话框反馈
  desktop.on('dialog', async (dialog) => { dialogWasShown = true; await dialog.accept() }) // 接收并关闭真实 dialog
  const actionButton = desktop.locator('a.btn, button.btn').first() // 接受语义正确的链接或按钮 CTA
  if (await actionButton.count() === 0) throw new Error('website has no interactive action button') // 宣传页必须提供真实交互入口
  await actionButton.click()                                // 点击页面实际存在的业务行动控件
  await desktop.waitForTimeout(400)                         // 等待按钮反馈更新 DOM
  const bodyTextAfter = await desktop.locator('body').textContent() // 读取点击后的可见页面文本
  const scrollAfter = await desktop.evaluate(() => window.scrollY) // 读取点击后的页面滚动位置
  if (!dialogWasShown && bodyTextAfter === bodyTextBefore && scrollAfter === scrollBefore) throw new Error('action button produced no visible feedback') // CTA 必须产生滚动、文本或 dialog 反馈
  await revealPage(desktop)                                  // 模拟桌面用户滚动并确认渐入内容显示
  await desktop.screenshot({ path: join(outputDirectory, 'website-desktop.png'), fullPage: true }) // 保存桌面全页截图

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } }) // 创建常见移动视口
  collectErrors(mobile, errors)                          // 开始收集移动运行错误
  await mobile.goto(websiteURL, { waitUntil: 'networkidle' }) // 通过真实 HTTP 加载移动页面
  const mobileOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth) // 检查移动横向溢出
  if (mobileOverflow) throw new Error('mobile page has horizontal overflow') // 移动布局不得超出视口
  const navigationToggle = mobile.locator('#navToggle, [aria-label*="导航"], [aria-label*="菜单"]').first() // 接受不同语义标签实现的移动菜单按钮
  if (await navigationToggle.count() === 0) throw new Error('website has no mobile navigation toggle') // 移动端必须提供可发现菜单入口
  await navigationToggle.click()                         // 打开移动导航菜单
  const navigationMenu = mobile.locator('#navMenu, nav').filter({ has: mobile.locator('a[href^="#"]') }).first() // 按业务链接而非固定 ul 标签定位菜单
  const menuIsVisible = await navigationMenu.evaluate((element) => { // 读取导航容器及其链接的真实可见状态
    const style = getComputedStyle(element)               // 检查容器是否参与布局
    const visibleLink = [...element.querySelectorAll('a[href^="#"]')].some((link) => { // 至少一个站内导航链接必须可见
      const linkStyle = getComputedStyle(link)             // 读取链接自身显示状态
      return linkStyle.display !== 'none' && linkStyle.visibility !== 'hidden' && link.getBoundingClientRect().height > 0 // 尺寸和样式共同证明可交互
    })
    return style.display !== 'none' && style.visibility !== 'hidden' && visibleLink // 容器与业务链接都必须可见
  })
  if (!menuIsVisible) throw new Error('mobile navigation did not open') // 菜单点击必须产生可见效果
  await navigationToggle.click()                             // 检查完成后关闭菜单，避免遮挡页面截图
  await revealPage(mobile)                                   // 模拟移动用户滚动并确认渐入内容显示
  await mobile.screenshot({ path: join(outputDirectory, 'website-mobile.png'), fullPage: true }) // 保存移动全页截图
  if (errors.length) throw new Error(`browser errors: ${errors.join('; ')}`) // 页面不得产生控制台或脚本错误

  process.stdout.write(JSON.stringify({ desktop: true, mobile: true, interactions: true })) // 向父测试器反馈完整通过结果
} finally {
  await browser.close()                                   // 无论通过或失败都释放 Chromium 进程
}
