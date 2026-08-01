/*
真实 Agent 端到端测试器：启动独立 Server 进程，只通过本机 HTTP/SSE 驱动全部 API。
测试从 OpenCode 配置读取 glm-5.2，让模型真实调用工具创建宣传网站，并验证审批、拒绝、中断、回滚和磁盘效果。
调用方式：在 server 目录运行 bun run test:e2e。
*/
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises' // 引入测试目录、真实文件检查与清理能力
import { tmpdir } from 'node:os'                                          // 引入隔离 Server 数据的系统临时目录
import { join, resolve } from 'node:path'                                 // 引入跨平台测试路径拼接能力

const serverDirectory = resolve(import.meta.dir, '..')                    // 定位独立 Bun Server 子项目根目录
const websiteDirectory = join(serverDirectory, 'test-output', 'agent-website') // 保存可供人工检查的网站产物
const report = []                                                         // 按执行顺序记录每个真实场景的结果
let serverProcess                                                          // 保存独立 Agent Server 子进程
let serverURL = ''                                                         // 保存子进程实际监听的本机 URL
let serverErrors = ''                                                      // 收集子进程错误用于真实 socket 失败诊断
const lastEventIDs = new Map()                                              // Session ID 到客户端最后确认的递增事件 ID


// --- 验证测试条件 ---
function check(condition, message) {
  if (!condition) throw new Error(message)                                // 任一真实效果不满足就立即判定测试失败
}


// --- 记录一个通过场景 ---
function pass(name, detail) {
  report.push({ name, detail })                                            // 保存最终汇报需要的场景和证据
  console.log(`PASS ${name}: ${detail}`)                                   // 实时反馈长任务当前进度
}


// --- 向真实 Server 发送 JSON API 请求 ---
async function api(path, method = 'GET', body) {
  const response = await fetch(`${serverURL}${path}`, {                    // 通过真实 TCP 端口发送 HTTP 请求
    method,                                                                // 使用场景指定的 HTTP 方法
    headers: body === undefined ? undefined : { 'content-type': 'application/json' }, // 有请求体时声明 JSON
    body: body === undefined ? undefined : JSON.stringify(body),           // 将业务数据序列化后传给 Server
  })
  const data = await response.json()                                       // 普通 API 统一读取 JSON 反馈
  return { response, data }                                                // 同时保留状态码和业务结果
}


// --- 消费一次真实 SSE 对话 ---
async function sendChat(body, onEvent = async () => {}) {
  let sessionID = body.sessionId                                           // 已有会话继续复用事件流和历史
  if (!sessionID) {
    const created = await api('/session', 'POST', {})                       // 通过正式 API 创建默认工作区会话
    check(created.response.ok && created.data.id, 'session creation failed before chat') // 会话必须真实持久化
    sessionID = created.data.id                                             // 保存后续发送和事件订阅归属
  }

  let response                                                             // 保存真实会话事件 HTTP 响应
  try {
    const afterID = lastEventIDs.get(sessionID) ?? 0                        // 续聊只接收上次确认之后的事件
    const eventResponse = fetch(`${serverURL}/session/events?sessionId=${sessionID}&afterId=${afterID}`) // 并发建立独立 SSE，空历史时等待首个新事件
    const sent = await fetch(`${serverURL}/session/send`, {                 // 再通过正式发送入口启动后台 Run
      method: 'POST',                                                       // 对话触发使用设计规定的 POST
      headers: { 'content-type': 'application/json' },                      // 请求体按 JSON 发送
      body: JSON.stringify({ sessionId: sessionID, content: body.message, agentId: body.agentId, model: body.model }), // 传入会话身份和消息内容
    })
    check(sent.ok && (await sent.json()).ok, '/session/send failed to start background run') // 发送请求必须立即反馈启动成功
    response = await eventResponse                                          // Run 已启动后取得包含首个事件的 SSE 响应
  } catch (error) {
    const exitCode = serverProcess.exitCode                                // 检查连接重置时 Server 子进程是否已经退出
    let healthState = 'unreachable'                                        // 默认认为进程无法继续服务请求
    try { healthState = `${(await fetch(`${serverURL}/health`)).status}` } catch {} // 再次探测真实健康接口
    throw new Error(`chat connection failed; serverExit=${exitCode}; health=${healthState}; cause=${error.message}`) // 反馈连接和进程状态
  }
  check(response.headers.get('content-type')?.includes('text/event-stream'), '/session/events did not return SSE') // 必须返回标准 SSE

  const reader = response.body.getReader()                                // 持续读取模型和工具实时事件
  const decoder = new TextDecoder()                                       // 将网络字节增量转换为 UTF-8 文本
  const events = []                                                       // 保存完整事件供场景结束后断言
  let pendingText = ''                                                    // 保存尚未形成完整 SSE 帧的文本
  try {
    while (true) {
      const { done, value } = await reader.read()                          // 等待下一批真实网络数据
      pendingText += decoder.decode(value, { stream: !done })              // 合并跨网络分块的 SSE 文本
      const frames = pendingText.split('\n\n')                            // SSE 空行表示一个事件结束
      pendingText = frames.pop() ?? ''                                    // 最后一段可能不完整，留到下批继续解析
      for (const frame of frames) {
        const eventID = Number(frame.match(/^id: (\d+)$/m)?.[1])            // 读取单会话递增事件 ID
        const eventName = frame.match(/^event: (.+)$/m)?.[1]               // 读取 Server 写入的事件类型
        const dataText = frame.match(/^data: (.+)$/m)?.[1]                 // 读取当前事件的 JSON 数据
        if (!eventName || !dataText) continue                             // 忽略空心跳或非业务行
        const event = { id: eventID, name: eventName, data: JSON.parse(dataText) } // 还原真实 SSE 业务事件
        events.push(event)                                                 // 保存事件时间线供后续检查
        if (eventID) lastEventIDs.set(sessionID, eventID)                  // 记录续聊恢复位置
        if (events.length % 1000 === 0) console.log(`  SSE progress: ${events.length} events, latest=${event.name}`) // 长模型输出每千个事件反馈进度
        await onEvent(event, events)                                       // 允许审批和中断场景在流进行时调用 API
        if (eventName === 'finish' || eventName === 'error') {             // 独立订阅不会由 Run 自动关闭
          await reader.cancel()                                            // 当前 Run 终态后主动释放 SSE 连接
          return events                                                    // 反馈本轮完整事件时间线
        }
      }
      if (done) break                                                      // Server 关闭 SSE 后结束本轮对话
    }
  } catch (error) {
    let healthState = 'unreachable'                                        // 网络流失败后探测 Server 是否仍然存活
    try { healthState = `${(await fetch(`${serverURL}/health`)).status}` } catch {} // 使用独立连接读取健康状态
    const eventNames = events.map((event) => event.name).join(',')         // 输出断开前实际收到的 SSE 时间线
    throw new Error(`SSE read failed; health=${healthState}; events=${eventNames}; cause=${error.message}`) // 反馈真实流断点
  }
  return events                                                           // 返回完整模型、工具与自定义事件时间线
}


// --- 等待独立 Server 报告监听地址 ---
async function readServerURL(output) {
  const reader = output.getReader()                                       // 读取子进程标准输出中的启动反馈
  const decoder = new TextDecoder()                                       // 将进程输出转换为文本
  let text = ''                                                           // 累加可能被拆分的启动行
  while (true) {
    const { done, value } = await reader.read()                            // 等待 Server 输出或退出
    if (done) throw new Error(`Agent Server exited before startup: ${text}`) // 未监听就退出属于启动失败
    text += decoder.decode(value, { stream: true })                        // 合并当前输出分块
    const match = text.match(/Agent Server listening on (http:\/\/127\.0\.0\.1:\d+)/) // 提取实际递增后的端口
    if (match) return match[1]                                             // 反馈所有真实 API 请求要使用的 URL
  }
}


// --- 收集独立 Server 错误输出 ---
async function collectServerErrors(output) {
  const reader = output.getReader()                                        // 持续读取子进程标准错误
  const decoder = new TextDecoder()                                        // 将错误字节转换为可诊断文本
  while (true) {
    const { done, value } = await reader.read()                             // 等待下一批错误或进程退出
    if (done) break                                                         // 子进程关闭后结束收集
    serverErrors += decoder.decode(value, { stream: true })                 // 保留完整错误供失败时输出
  }
}


// --- 启动使用 OpenCode 模型配置的独立 Server ---
async function startServer() {
  const openCodePath = join(process.env.USERPROFILE, '.config', 'opencode', 'opencode.json') // 定位用户要求使用的模型配置
  const openCodeConfig = JSON.parse(await readFile(openCodePath, 'utf-8')) // 读取真实 OpenCode JSON
  const provider = openCodeConfig.provider?.aker                          // 选择包含 glm-5.2 的目标供应商
  check(provider?.models?.['glm-5.2'], 'glm-5.2 is missing from OpenCode config') // 缺少目标模型时禁止降级测试

  const dataDirectory = await mkdtemp(join(tmpdir(), 'agent-e2e-'))        // 为 Server 建立真实且隔离的用户数据目录
  const config = {                                                        // 构造 Server 能直接加载的真实运行配置
    activeProvider: 'aker',                                               // 严格使用用户指定供应商
    activeModel: 'glm-5.2',                                               // 严格使用用户指定模型
    providers: { aker: { apiKey: provider.options.apiKey, baseURL: provider.options.baseURL, models: ['glm-5.2'] } }, // 复用真实认证和 API 地址
    systemPrompt: '你是自主执行任务的 Agent。必须使用工具完成用户要求并检查结果，不能只解释。完成后调用 task_done。', // 要求模型实际行动
    permissions: { read_file: 'allow', write_file: 'allow', list_files: 'allow', search_files: 'allow', run_command: 'allow', web_fetch: 'allow', task_list_update: 'allow', task_done: 'allow' }, // 网站任务允许真实工具和任务跟踪执行
    modelLimits: { 'glm-5.2': provider.models['glm-5.2'].limit },          // 使用 OpenCode 中声明的上下文限制
  }
  await writeFile(join(dataDirectory, 'config.json'), JSON.stringify(config, null, 2)) // 将真实配置写入隔离目录

  serverProcess = Bun.spawn([process.execPath, 'run', 'server.js'], {      // 启动与用户运行方式一致的独立 Bun 子进程
    cwd: serverDirectory,                                                  // 从 Server 子项目目录运行入口
    env: { ...process.env, AGENT_DATA_DIR: dataDirectory, PORT: '48732' }, // 指向隔离数据并提供首选测试端口
    stdout: 'pipe',                                                        // 捕获实际监听端口
    stderr: 'pipe',                                                        // 捕获真实 Server 错误供失败诊断
  })
  collectServerErrors(serverProcess.stderr).catch(() => {})                // 后台持续收集，不阻塞 Server 启动
  serverURL = await readServerURL(serverProcess.stdout)                    // 等待 Server 完成初始化并取得真实 URL
  const health = await api('/health')                                      // 通过 TCP 验证进程已经可以服务请求
  check(health.response.status === 200 && health.data.ok, 'health API failed after process startup') // 启动必须反馈健康
  pass('独立进程启动', `${serverURL}/health returned 200`)                  // 记录真实网络启动证据
}


// --- 配置与工具 API 场景 ---
async function testConfigAndTools() {
  const current = await api('/config')                                    // 从独立 Server 读取当前配置
  check(current.data.activeModel === 'glm-5.2', 'active model is not glm-5.2') // 验证真实模型选择
  check(current.data.providers.aker.apiKey === '[REDACTED]', 'config API exposed API key') // 验证密钥脱敏

  const updated = await api('/config', 'PATCH', { systemPrompt: '你是自主执行任务的 Agent。必须使用工具完成用户要求并检查结果，不能只解释。完成后调用 task_done。' }) // 走正式配置写入 API
  check(updated.data.ok, 'config update failed')                           // 配置必须成功写入磁盘
  const tools = await api('/tool/list')                                    // 读取启动扫描出的真实工具
  const toolNames = tools.data.map((item) => item.name)                    // 提取模型实际可见的工具名称
  for (const name of ['read_file', 'write_file', 'list_files', 'search_files', 'run_command', 'web_fetch', 'task_list_update', 'task_done']) check(toolNames.includes(name), `tool missing: ${name}`) // 内置工具必须完整
  const reloaded = await api('/tool/reload', 'POST')                       // 通过 HTTP 触发真实目录重载
  check(reloaded.data.ok && reloaded.data.loaded >= 7, 'tool reload failed') // 重载后工具数量必须完整
  pass('配置与工具 API', `model=glm-5.2, loaded=${reloaded.data.loaded}`) // 记录配置和工具证据
}


// --- 让真实 Agent 创建宣传网站 ---
async function buildWebsite() {
  const shouldReuseWebsite = process.env.E2E_REUSE_WEBSITE === '1'         // 失败续跑时允许复用上一轮刚生成的真实产物
  if (!shouldReuseWebsite) await rm(websiteDirectory, { recursive: true, force: true }) // 完整模式清除旧产物，证明文件由本次任务创建
  await mkdir(websiteDirectory, { recursive: true })                       // 确保 Agent 有明确的网站工作目录
  const prompt = shouldReuseWebsite
    ? `使用 list_files 和 read_file 检查 ${websiteDirectory} 中刚生成的 index.html、styles.css、app.js，确认产品名为 Agent、年份为 2026、资源引用完整，然后调用 task_done，summary 必须包含 WEBSITE_READY。` // 续跑模式仍通过真实模型和工具建立任务会话
    : `使用工具在 ${websiteDirectory} 创建一个可直接运行的中文 Agent 产品宣传网站。必须创建 index.html、styles.css、app.js 三个文件。产品正式名称统一为“Agent”，版权年份为 2026；只宣传 README 中的对话驱动、无限 ReAct 循环、工具调用、权限审批、checkpoint 回滚，以及桌面、CLI、开发三种模式，禁止虚构数据库、浏览器 SaaS、双人复核、企业审计、多模态或用户数量。包含响应式导航、真实产品界面演示区、功能区、工作流程和明确行动按钮。禁止使用外部图片或框架，确保 HTML 正确引用 ./styles.css 和 ./app.js。写完后用 read_file 和 list_files 检查文件，再调用 task_done，summary 必须包含 WEBSITE_READY。` // 完整模式让真实模型从空目录建站
  const events = await sendChat({ message: prompt })                       // 只通过正式 Session API 驱动 Agent 创建文件
  const created = events.find((event) => event.name === 'session-created') // 获取 Server 自动创建的真实会话
  check(created?.data?.id, 'website task did not create a session')         // 新任务必须反馈会话 ID
  const requiredTool = shouldReuseWebsite ? 'read_file' : 'write_file'     // 两种模式分别验证真实检查或真实创建动作
  check(events.some((event) => event.name === 'tool-call' && event.data.toolName === requiredTool), `Agent never called ${requiredTool}`) // 模型必须调用场景要求的真实工具
  check(events.some((event) => JSON.stringify(event.data).includes('WEBSITE_READY')), 'Agent did not report WEBSITE_READY') // 必须明确完成任务
  pass('真实 Agent 建站', `session=${created.data.id}, events=${events.length}, mode=${shouldReuseWebsite ? 'verify-existing' : 'create-from-empty'}`) // 记录模型任务证据
  return created.data.id                                                    // 反馈后续续聊与回滚使用的会话 ID
}


// --- 检查网站文件与浏览效果 ---
async function inspectWebsite() {
  const indexHTML = await readFile(join(websiteDirectory, 'index.html'), 'utf-8') // 读取 Agent 真实生成的 HTML
  const stylesCSS = await readFile(join(websiteDirectory, 'styles.css'), 'utf-8') // 读取 Agent 真实生成的样式
  const appJS = await readFile(join(websiteDirectory, 'app.js'), 'utf-8')         // 读取 Agent 真实生成的交互脚本
  check(indexHTML.length > 2500, 'index.html is too small to be a complete product site') // 页面必须有完整信息结构
  check(stylesCSS.length > 3000, 'styles.css is too small for a polished responsive site') // 样式必须足够完整
  check(appJS.length > 300, 'app.js is too small to provide meaningful interaction') // 脚本必须具有真实交互
  check(indexHTML.includes('./styles.css') && indexHTML.includes('./app.js'), 'HTML does not reference local CSS and JS') // 本地资源引用必须正确
  check(stylesCSS.includes('@media'), 'website has no responsive breakpoint')    // 页面必须覆盖移动端
  for (const keyword of ['ReAct', '权限', '回滚', 'CLI']) check(indexHTML.includes(keyword), `website content missing: ${keyword}`) // 宣传内容必须覆盖核心能力
  check(!indexHTML.includes('AgentPro'), 'website still uses invented AgentPro brand') // 品牌必须与项目 README 一致
  check(indexHTML.includes('© 2026') || indexHTML.includes('&copy; 2026'), 'website copyright year is not current') // 接受 Unicode 或 HTML 实体两种合法版权写法
  for (const unsupported of ['数据库', '双人复核', '数千名', '多模态展示', '浏览器 SaaS']) check(!indexHTML.includes(unsupported), `website still contains unsupported claim: ${unsupported}`) // 禁止宣传未验证能力

  const staticServer = Bun.serve({                                              // 启动真实静态 HTTP 服务验证三个文件可访问
    port: 0,                                                                    // 让系统分配隔离测试端口
    fetch(request) {
      const pathName = new URL(request.url).pathname                            // 从浏览器请求读取资源路径
      const fileName = pathName === '/' ? 'index.html' : pathName.slice(1)      // 根路径映射到首页文件
      return new Response(Bun.file(join(websiteDirectory, fileName)))           // 从 Agent 输出目录返回真实资源
    },
  })
  try {
    for (const path of ['/', '/styles.css', '/app.js']) {
      const response = await fetch(`http://127.0.0.1:${staticServer.port}${path}`) // 通过真实 HTTP 请求页面资源
      check(response.status === 200 && (await response.text()).length > 0, `website resource failed: ${path}`) // 每个资源必须成功加载
    }

    const browserCheck = Bun.spawn(['node', join(import.meta.dir, 'browser-check.mjs'), `http://127.0.0.1:${staticServer.port}/`, join(serverDirectory, 'test-output')], { cwd: serverDirectory, stdout: 'pipe', stderr: 'pipe' }) // 用 Playwright 官方支持的 Node 运行时启动 Chromium
    const [browserOutput, browserError, browserExit] = await Promise.all([new Response(browserCheck.stdout).text(), new Response(browserCheck.stderr).text(), browserCheck.exited]) // 等待浏览器检查和截图完成
    check(browserExit === 0, `browser check failed: ${browserError || browserOutput}`) // Chromium 子进程必须正常完成
    const browserResult = JSON.parse(browserOutput.trim())                       // 读取桌面、移动和交互检查结果
    check(browserResult.desktop && browserResult.mobile && browserResult.interactions, 'browser check returned incomplete result') // 所有浏览器场景必须通过
  } finally {
    staticServer.stop(true)                                                     // 检查结束后释放静态服务端口
  }
  pass('网站监督检查', `HTML=${indexHTML.length}, CSS=${stylesCSS.length}, JS=${appJS.length}, desktop/mobile browser passed`) // 记录质量和浏览器证据
}


// --- 会话与 checkpoint 正向场景 ---
async function testSessionsAndRollback(websiteSessionID) {
  const continued = await sendChat({ sessionId: websiteSessionID, message: `使用 write_file 在 ${websiteDirectory} 创建 verification.txt，内容必须是 CHECKPOINT_SECOND_STEP，然后调用 task_done。` }) // 用同一会话制造后续真实步骤
  check(continued.some((event) => JSON.stringify(event.data).includes('CHECKPOINT_SECOND_STEP')), 'continued session did not execute second task') // 续聊必须执行工具
  const detail = await api(`/session/${websiteSessionID}`)                    // 读取包含真实工具历史的完整会话
  check(detail.data.messages.some((message) => message.role === 'tool'), 'session has no persisted tool results') // 工具结果必须持久化
  const listed = await api('/session/list')                                   // 从摘要列表确认真实会话存在
  check(listed.data.some((session) => session.id === websiteSessionID), 'website session missing from list') // 列表必须包含任务会话

  const rolledBack = await api('/session/history', 'POST', { sessionId: websiteSessionID, action: 'rollback-checkpoint', checkpoint: 1 }) // 回滚到首次真实工具 checkpoint
  check(rolledBack.data.ok, 'checkpoint rollback failed')                     // 正向回滚必须成功
  const restored = await api('/session/history', 'POST', { sessionId: websiteSessionID, action: 'undo' }) // 撤销刚才的真实回滚
  check(restored.data.ok && restored.data.restoredMessages > 0, 'undo rollback restored no messages') // 必须恢复实际消息

  const created = await api('/session', 'POST', {})                            // 通过正式 API 创建待删除会话
  check(created.data.id?.startsWith('ses_'), 'session create returned invalid ID') // ID 格式必须正确
  const removed = await api('/session', 'DELETE', { sessionId: created.data.id }) // 删除真实磁盘会话
  check(removed.data.ok, 'session delete failed')                               // 删除操作必须成功
  const missing = await fetch(`${serverURL}/session/${created.data.id}`)        // 再次通过 HTTP 查询被删除会话
  check(missing.status === 404, 'deleted session is still available')           // 删除效果必须反馈为 404
  pass('会话与 checkpoint API', `rollback restored ${restored.data.restoredMessages} messages`) // 记录真实回滚证据
}


// --- 工具批准正向场景 ---
async function testApprove() {
  await api('/config', 'PATCH', { permissions: { write_file: 'ask', task_done: 'allow' } }) // 将写文件切到真实人工审批模式
  const approvedPath = join(serverDirectory, 'test-output', 'approved.txt')     // 定义批准后必须出现的真实文件
  await rm(approvedPath, { force: true })                                       // 删除旧文件，防止假阳性
  let sessionID = ''                                                            // 从 SSE 会话创建事件取得审批所属会话
  let approvalCount = 0                                                         // 确认 Agent 确实进入过 ask 分支
  const events = await sendChat({ message: `必须使用 write_file 在 ${approvedPath} 写入 APPROVED_REAL_EFFECT，然后调用 task_done。` }, async (event) => {
    if (event.name === 'session-created') sessionID = event.data.id             // 保存审批请求所属会话
    if (event.name !== 'tool-approval-request') return                          // 只处理权限确认事件
    approvalCount += 1                                                          // 记录真实 ask 触发次数
    const approved = await api('/session/approval', 'POST', { sessionId: sessionID, runId: event.data.runID, toolCallId: event.data.id, decision: 'allow-once' }) // 并发调用批准 API 恢复挂起工具
    check(approved.data.ok, 'approve API rejected a pending tool')              // 待审批工具必须成功恢复
  })
  check(approvalCount > 0, 'Agent never entered approval flow')                 // 模型必须产生待审批写文件调用
  check((await readFile(approvedPath, 'utf-8')).includes('APPROVED_REAL_EFFECT'), 'approved tool produced no file effect') // 批准后必须真实写盘
  check(events.some((event) => event.name === 'tool-result'), 'approved flow returned no tool result') // SSE 必须反馈执行结果
  pass('approve 正向流程', `${approvalCount} pending write_file call approved and executed`) // 记录审批证据
}


// --- 工具拒绝正向场景 ---
async function testReject() {
  const rejectedPath = join(serverDirectory, 'test-output', 'rejected.txt')     // 定义拒绝后绝不能出现的文件
  await rm(rejectedPath, { force: true })                                       // 清除旧文件，保证副作用判断可靠
  let sessionID = ''                                                            // 保存拒绝请求所属会话
  let rejectionCount = 0                                                        // 确认真实 ask 分支被拒绝
  await sendChat({ message: `必须使用 write_file 在 ${rejectedPath} 写入 REJECTED_SHOULD_NOT_EXIST，然后调用 task_done。` }, async (event) => {
    if (event.name === 'session-created') sessionID = event.data.id             // 保存新会话 ID
    if (event.name !== 'tool-approval-request') return                          // 等待模型产生写文件审批
    rejectionCount += 1                                                         // 记录待拒绝工具调用
    const rejected = await api('/session/approval', 'POST', { sessionId: sessionID, runId: event.data.runID, toolCallId: event.data.id, decision: 'deny' }) // 并发拒绝挂起工具
    check(rejected.data.ok, 'reject API rejected no pending tool')              // 拒绝指令必须命中真实等待项
  })
  check(rejectionCount > 0, 'Agent never entered rejection flow')               // 确认拒绝测试不是空跑
  check(!(await Bun.file(rejectedPath).exists()), 'rejected write_file still modified disk') // 拒绝后不得产生真实文件
  pass('reject 正向流程', `${rejectionCount} pending write_file call rejected with no disk effect`) // 记录拒绝证据
}


// --- 对话中断正向场景 ---
async function testStop() {
  await api('/config', 'PATCH', { permissions: { write_file: 'allow', task_done: 'allow' } }) // 恢复普通工具权限，隔离中断原因
  let stopResult                                                                // 保存循环运行期间 stop API 的真实反馈
  const events = await sendChat({ message: '开始一个需要多步工具检查的长任务：先逐项检查当前目录，再规划后续操作。不要立即结束。' }, async (event) => {
    if (event.name !== 'session-created' || stopResult) return                  // 会话创建后、模型完成前只中断一次
    stopResult = await api('/session/stop', 'POST', { sessionId: event.data.id }) // 在 SSE 仍打开时通过 HTTP 中断循环
  })
  check(stopResult?.data?.ok, 'stop API did not stop a running loop')           // 必须命中真实运行中的 AbortController
  check(events.some((event) => event.name === 'error' || event.name === 'finish'), 'stopped stream did not terminate cleanly') // SSE 必须结束而非挂死
  pass('stop 正向流程', 'running SSE loop accepted stop and closed')            // 记录真实中断证据
}


// --- 执行全部真实场景并输出报告 ---
async function main() {
  await startServer()                                                          // 首先启动独立真实进程
  try {
    await testConfigAndTools()                                                 // 验证配置和工具 API
    const websiteSessionID = await buildWebsite()                              // 让真实模型使用工具创建网站
    await inspectWebsite()                                                     // 监督检查文件和 HTTP 可访问性
    await testSessionsAndRollback(websiteSessionID)                            // 验证续聊、会话和 checkpoint
    await testApprove()                                                        // 验证 ask → approve → 真实副作用
    await testReject()                                                         // 验证 ask → reject → 无副作用
    await testStop()                                                           // 验证运行中 Agent 可被中断
  } finally {
    serverProcess?.kill()                                                      // 无论通过或失败都关闭独立 Server 进程
    await serverProcess?.exited                                                // 等待端口与文件监听资源完全释放
  }

  console.log('\nREAL AGENT E2E PASSED')                                     // 输出自动化系统可识别的最终结果
  console.log(`Website: ${websiteDirectory}`)                                 // 反馈人工检查网站的位置
  console.log(`Scenarios: ${report.length}`)                                  // 反馈通过的真实场景数量
  for (const item of report) console.log(`- ${item.name}: ${item.detail}`)     // 输出每个场景的实际证据
}


try {
  await main()                                                                // 直接运行完整端到端监督流程
} catch (error) {
  if (serverErrors) console.error(`\nAgent Server stderr:\n${serverErrors}`) // 失败时展示子进程真实错误根因
  throw error                                                                 // 保留非零退出码供自动化识别
}
