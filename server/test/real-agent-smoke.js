/*
真实 Agent smoke：复用用户现有模型配置，通过真实 HTTP API 让 Agent 在隔离工作区创建静态网站。
脚本不修改用户配置，只把当前供应商的 api、key 和 models 写入临时数据目录。
调用示例：bun run test/real-agent-smoke.js。
*/
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises' // 引入临时目录和网站文件检查能力
import { tmpdir } from 'node:os'                         // 引入系统临时目录
import { basename, extname, join } from 'node:path'     // 引入配置、网站和静态资源路径处理能力
import { createApp } from '../server.js'                // 引入真实 Agent HTTP 应用

const sourceConfigPath = process.env.REAL_AGENT_CONFIG ?? join(process.env.USERPROFILE ?? '', '.agent', 'config.json') // 默认复用现有 Agent 配置
const timeoutMs = Number(process.env.REAL_AGENT_TIMEOUT ?? 300000) // 真实任务最多等待五分钟
process.env.AGENT_REQUEST_TIMEOUT_MS ??= process.env.REAL_AGENT_REQUEST_TIMEOUT ?? '60000' // smoke 单次挂起一分钟后进入无限重试
const temporaryRoot = await mkdtemp(join(tmpdir(), 'real-agent-smoke-')) // 隔离服务数据和网站工作区
const dataDirectory = join(temporaryRoot, '.agent')      // 临时服务端数据目录
const websiteDirectory = join(temporaryRoot, 'website') // Agent 唯一允许修改的网站目录
await mkdir(websiteDirectory, { recursive: true })       // 添加工作区前确保目录存在

let app                                                   // 保存真实监听中的 Agent 应用
let closeApp                                              // 保存 Agent 资源关闭动作
let websiteServer                                         // 保存网站验证 HTTP 服务
let subscriptionReader                                    // 保存 SSE 读取器供最终清理


// --- 执行真实 Agent 网站任务 ---
try {
  const selected = await readCurrentProvider(sourceConfigPath) // 从旧或新格式读取当前真实供应商
  const created = await createApp({ dataDirectory })     // 使用隔离数据目录启动正式后端
  app = created.app                                      // 保存用于实际监听的 Elysia 应用
  closeApp = created.close                               // 保存执行结束后的资源清理动作
  app.listen({ hostname: '127.0.0.1', port: 0, idleTimeout: 255 }) // 使用系统分配端口建立真实网络服务
  const apiRoot = `http://127.0.0.1:${app.server.port}`  // 后续操作全部通过 HTTP API

  await api(apiRoot, '/config', 'PATCH', {               // 把真实供应商写入临时配置
    provider: { api: selected.api, key: selected.key, models: selected.models },
  })
  const workspace = await api(apiRoot, '/workspace', 'POST', { path: websiteDirectory }) // 创建真实工作区记录
  const session = await api(apiRoot, '/session', 'POST', { workspaceId: workspace.id, provider: selected.name, model: selected.model }) // 创建真实模型会话
  const subscription = await subscribe(apiRoot, session.id) // 发送任务前建立 SSE 连接
  subscriptionReader = subscription.reader              // 保存读取器供 finally 释放

  const task = [
    '在当前工作区创建一个完整、可直接运行的静态网站。',
    '主题：软件团队的 Sprint 控制台。页面必须包含项目标题、当前冲刺指标、任务看板和一个可交互的筛选按钮。',
    '必须使用 write_file 工具创建且只创建 index.html、styles.css、script.js 三个文件。',
    'index.html 必须正确引用 styles.css 和 script.js；不得只回复代码或方案。',
    '完成并检查文件后调用 finish 工具。',
  ].join('\n')
  const sent = await api(apiRoot, '/session/send', 'POST', { id: session.id, content: task }) // 通过正式 API 启动 Agent
  const outcome = await waitForOutcome(subscription, timeoutMs) // 等待真实 Agent 完成或报错
  if (outcome.status !== 'idle') throw new Error(`Agent ended with status ${outcome.status}: ${outcome.error ?? ''}`) // error 状态视为失败

  const files = (await readdir(websiteDirectory)).sort() // 检查 Agent 实际写入的工作区
  const expectedFiles = ['index.html', 'script.js', 'styles.css'] // 任务明确要求的最小网站文件
  if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) throw new Error(`unexpected website files: ${files.join(', ')}`) // 多文件或缺文件都说明任务未按要求完成
  const [html, css, script] = await Promise.all(expectedFiles.map((name) => readFile(join(websiteDirectory, name), 'utf8'))) // 读取真实产物
  if (!/<html[\s>]/i.test(html) || !html.includes('styles.css') || !html.includes('script.js')) throw new Error('index.html is not a complete linked page') // 验证页面和资源引用
  if (css.trim().length < 100 || script.trim().length < 50) throw new Error('generated CSS or JavaScript is unexpectedly small') // 排除空壳网站

  websiteServer = Bun.serve({                           // 使用真实 HTTP 服务加载生成网站
    port: 0,                                             // 使用系统分配端口避免冲突
    async fetch(request) {
      const path = new URL(request.url).pathname         // 读取浏览器请求路径
      const name = path === '/' ? 'index.html' : basename(path) // 根路径返回生成主页
      if (!expectedFiles.includes(name)) return new Response('Not Found', { status: 404 }) // 只公开三个生成文件
      return new Response(Bun.file(join(websiteDirectory, name)), { headers: { 'content-type': contentType(name) } }) // 返回真实生成资源
    },
  })
  const websiteRoot = `http://127.0.0.1:${websiteServer.port}` // 构造页面验证地址
  const [pageResponse, cssResponse, scriptResponse] = await Promise.all([
    fetch(`${websiteRoot}/`),                            // 请求生成主页
    fetch(`${websiteRoot}/styles.css`),                 // 请求生成样式
    fetch(`${websiteRoot}/script.js`),                  // 请求生成脚本
  ])
  if (!pageResponse.ok || !cssResponse.ok || !scriptResponse.ok) throw new Error('generated website did not load through HTTP') // 任一资源失败即 smoke 失败
  const pageText = await pageResponse.text()             // 读取 HTTP 返回页面而不是磁盘原文
  if (!pageText.includes('styles.css') || !pageText.includes('script.js')) throw new Error('HTTP page lost required asset links') // 验证服务返回正确主页

  console.log(JSON.stringify({                           // 只输出非敏感测试结果
    ok: true,
    provider: selected.name,
    model: selected.model,
    apiStatus: outcome.status,
    eventCounts: countEvents(subscription.events),
    websiteFiles: files,
    websiteBytes: { html: html.length, css: css.length, script: script.length },
    pageStatus: pageResponse.status,
    assetStatuses: [cssResponse.status, scriptResponse.status],
    temporaryRoot,
  }, null, 2))
} catch (error) {
  if (app?.server) {
    const sessions = await fetch(`http://127.0.0.1:${app.server.port}/workspace`).then((response) => response.json()).catch(() => []) // 尝试定位运行会话
    const sessionId = sessions.flatMap((workspace) => workspace.sessions ?? [])[0]?.id // 读取临时工作区首个会话
    if (sessionId) await fetch(`http://127.0.0.1:${app.server.port}/session/stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: sessionId }) }).catch(() => {}) // 超时或失败时停止真实 Agent
  }
  console.error(JSON.stringify({ ok: false, error: error.message, temporaryRoot }, null, 2)) // 保留隔离目录供失败诊断
  process.exitCode = 1                                   // 向调用方反馈 smoke 失败
} finally {
  await subscriptionReader?.cancel().catch(() => {})    // 关闭 SSE 客户端
  websiteServer?.stop(true)                             // 关闭生成网站 HTTP 服务
  await closeApp?.().catch(() => {})                    // 停止 Agent 后台任务和连接
  app?.stop()                                            // 停止 Agent HTTP 监听
}


// --- 读取现有供应商配置 ---
async function readCurrentProvider(path) {
  const config = await Bun.file(path).json()             // Bun 直接按 UTF-8 读取现有 JSON
  if (config.provider?.api && config.provider?.key) {
    const model = config.provider.models?.[0]            // 新最小格式使用首个可用模型
    if (!model) throw new Error('existing provider has no model') // 没有模型无法测试
    return { name: 'provider', model, api: config.provider.api, key: config.provider.key, models: config.provider.models } // 返回最小格式
  }

  const name = config.activeProvider ?? Object.keys(config.providers ?? {})[0] // 旧格式使用当前供应商
  const provider = config.providers?.[name]              // 读取旧供应商定义
  const model = process.env.REAL_AGENT_MODEL ?? provider?.models?.[0] ?? config.activeModel // 默认使用现有列表首个模型，也允许显式覆盖
  const api = provider?.baseURL ?? provider?.api          // 兼容旧地址字段
  const key = provider?.apiKey ?? provider?.key           // 兼容旧密钥字段
  if (!name || !api || !key || !model) throw new Error('existing Agent config has no usable provider') // 缺少任一真实请求字段即停止
  return { name, model, api, key, models: provider.models ?? [model] } // 返回不暴露密钥的运行参数对象
}


// --- 请求 Agent API ---
async function api(root, path, method = 'GET', body) {
  const response = await fetch(`${root}${path}`, {
    method,                                              // 使用调用方指定 HTTP 动作
    headers: body ? { 'content-type': 'application/json' } : undefined, // JSON 请求声明正文类型
    body: body ? JSON.stringify(body) : undefined,      // 有请求体时序列化 JSON
  })
  const value = await response.json()                    // 最小 API 所有普通响应都是 JSON
  if (!response.ok) throw new Error(`${method} ${path} failed: ${value.error ?? response.status}`) // 非成功状态中断 smoke
  return value                                           // 返回业务结果
}


// --- 订阅会话 SSE ---
async function subscribe(root, sessionId) {
  const controller = new AbortController()               // 单独限制 SSE 建连等待
  const timeout = setTimeout(() => controller.abort(), 15000) // 15 秒没有响应头就判定后端连接失败
  const response = await fetch(`${root}/session/events?id=${encodeURIComponent(sessionId)}`, { signal: controller.signal }) // 建立真实网络 SSE 请求
  clearTimeout(timeout)                                  // 响应到达后不再中断持续连接
  if (!response.ok) throw new Error(`SSE subscription failed with ${response.status}`) // 订阅失败不能继续发送
  return { reader: response.body.getReader(), pending: '', events: [] } // 保存流解析状态
}


// --- 等待 Agent 最终状态 ---
async function waitForOutcome(subscription, timeout) {
  const deadline = Date.now() + timeout                  // 设置真实任务最大等待时间
  let lastError = ''                                     // 保存最后一条错误用于失败反馈
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now()             // 计算当前读取剩余预算
    const result = await Promise.race([
      subscription.reader.read(),                       // 等待下一批 SSE 数据
      Bun.sleep(remaining).then(() => ({ timeout: true })), // 到期后主动结束等待
    ])
    if (result.timeout) throw new Error(`Agent timed out after ${timeout}ms${lastError ? `; last error: ${lastError}` : ''}`) // 超时包含最近错误
    if (result.done) throw new Error('Agent SSE closed before completion') // 提前断线视为失败
    subscription.pending += new TextDecoder().decode(result.value, { stream: true }) // 合并跨批次 UTF-8 文本
    const frames = subscription.pending.split('\n\n') // 标准 SSE 空行分帧
    subscription.pending = frames.pop() ?? ''           // 未完成帧留给下一批
    for (const frame of frames) {
      const name = frame.match(/^event: (.+)$/m)?.[1]   // 读取业务事件名
      const dataText = frame.match(/^data: (.+)$/m)?.[1] // 读取 JSON 数据
      if (!name || !dataText) continue                  // 忽略空帧
      const event = { name, data: JSON.parse(dataText) } // 解析真实事件
      subscription.events.push(event)                   // 保存用于统计和诊断
      if (['tool-call', 'tool-result', 'error', 'status'].includes(name)) console.error(`[real-smoke] ${name}: ${summarizeEvent(event)}`) // 输出不含密钥的执行进度
      if (name === 'error') lastError = event.data.message ?? '' // 更新最近错误
      if (name === 'status' && ['idle', 'error'].includes(event.data.status)) return { status: event.data.status, error: lastError } // 收到终态后返回
    }
  }
  throw new Error(`Agent timed out after ${timeout}ms`) // 防御性超时
}


// --- 统计 SSE 事件 ---
function countEvents(events) {
  return Object.fromEntries([...new Set(events.map((event) => event.name))].map((name) => [name, events.filter((event) => event.name === name).length])) // 按名称汇总事件数量
}


// --- 创建安全事件摘要 ---
function summarizeEvent(event) {
  if (event.name === 'tool-call') return event.data.toolCall?.toolName ?? 'unknown' // 工具调用只输出名称
  if (event.name === 'tool-result') return `${event.data.toolResult?.isError ? 'error' : 'ok'}:${event.data.toolResult?.toolCallId ?? ''}` // 工具结果只输出状态和 ID
  if (event.name === 'status') return event.data.status ?? 'unknown' // 状态事件只输出状态值
  return event.data.message ?? 'error'                  // 错误事件输出供应商错误文案
}


// --- 选择静态资源类型 ---
function contentType(name) {
  const extension = extname(name)                       // 根据生成文件扩展名选择类型
  if (extension === '.html') return 'text/html; charset=utf-8' // HTML 页面类型
  if (extension === '.css') return 'text/css; charset=utf-8' // CSS 资源类型
  return 'text/javascript; charset=utf-8'               // 剩余唯一文件是 JavaScript
}
