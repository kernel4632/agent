/*
真实页面验收：使用 Playwright 管理的 Chromium 加载 Agent 生成网站并验证交互。
本脚本由 real-agent-smoke.js 通过 Node 子进程调用，避免 Bun 与 Playwright 调试管道不兼容。
调用示例：node test/browser-smoke.cjs http://127.0.0.1:8080。
*/
const { chromium } = require('../../frontend/node_modules/playwright') // 引入真实 Chromium 自动化能力


// --- 验收生成页面 ---
async function inspect(root) {
  if (!root) throw new Error('website URL is required') // 没有目标地址时不能启动无意义浏览器
  const browser = await chromium.launch({ headless: true, timeout: 30000 }) // 启动 Playwright 管理的 Chromium
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }) // 使用稳定桌面视口
    const errors = []                                    // 收集脚本和控制台错误
    page.on('pageerror', (error) => errors.push(error.message)) // 记录未捕获脚本错误
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) }) // 记录控制台错误
    await page.goto(root, { waitUntil: 'networkidle' })   // 等待页面及静态资源完成加载

    const taskCount = await page.locator('.task-card').count() // 读取真实渲染任务卡数量
    if (taskCount < 6) throw new Error(`browser rendered only ${taskCount} task cards`) // 页面必须满足验收数量
    const status = await page.locator('.task-card').first().getAttribute('data-status') // 读取首个真实任务状态
    if (!status) throw new Error('first task card has no data-status') // 状态缺失时无法验证筛选
    const matchingCount = await page.locator(`.task-card[data-status="${status}"]`).count() // 计算该状态预期数量
    const filter = page.locator(`[data-filter="${status}"]`).first() // 定位对应可见筛选按钮
    if (await filter.count() === 0) throw new Error(`filter button not found for ${status}`) // 每种任务状态必须可筛选
    await filter.click()                                  // 真实点击筛选按钮
    const filteredCount = await page.locator('.task-card:visible').count() // 读取交互后可见任务卡
    if (filteredCount !== matchingCount) throw new Error(`filter showed ${filteredCount} cards instead of ${matchingCount}`) // 筛选结果必须准确
    if (errors.length > 0) throw new Error(`browser errors: ${errors.join('; ')}`) // 页面运行不能产生错误
    return { taskCount, filteredCount, errors: errors.length } // 返回主 smoke 可汇总的结果
  } finally {
    await browser.close()                                // 无论验收成功失败都关闭浏览器进程
  }
}


inspect(process.argv[2])
  .then((result) => console.log(JSON.stringify(result))) // 标准输出只返回结构化成功结果
  .catch((error) => { console.error(error.stack || error.message); process.exitCode = 1 }) // 标准错误保留诊断信息
