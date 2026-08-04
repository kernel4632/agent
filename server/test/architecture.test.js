/*
最小后端契约测试：通过真实 Elysia 请求、磁盘 JSON、本机模型协议和 SSE 验证 Agent 行为。
本机模型只替代外部网络，配置、会话、工具定义、模型流和停止链仍使用正式实现。
调用方式：bun test test/architecture.test.js。
*/
import { afterAll, beforeAll, describe, expect, it } from 'bun:test' // 引入 Bun 测试生命周期和断言
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises' // 引入隔离目录、结构检查和清理能力
import { tmpdir } from 'node:os'                         // 引入系统临时目录
import { join } from 'node:path'                        // 引入跨平台路径拼接
import { Session } from '../commands/session.js'        // 引入会话运行时身份和删除动作供回归验证
import { Tool } from '../commands/tool.js'              // 引入并行工具指令供独立验证
import { createApp } from '../server.js'                // 引入完整单文件路由应用
import { store } from '../store.js'                     // 引入严格 store 结构供契约断言
import { Retry } from '../utils/retry.js'               // 引入无限重试封装供次数契约验证

let app                                                  // 保存测试使用的 Elysia 应用
let closeApp                                             // 保存应用关闭动作
let dataDirectory                                       // 保存测试专属 .agent 目录
let modelServer                                         // 保存本机 OpenAI-compatible 服务
const modelRequests = []                                // 保存模型收到的真实请求体
let retryOnceFailures = 0                               // 记录一次失败后恢复场景是否已经失败
let interruptedStreams = 0                              // 记录流式响应是否收到真实网络中断


// --- 启动隔离后端和模型服务 ---
beforeAll(async () => {
  modelServer = Bun.serve({
    port: 0,                                             // 使用系统分配端口避免冲突
    async fetch(request) {
      const url = new URL(request.url)                   // 区分模型请求和 Web 工具测试请求
      if (url.pathname === '/slow') {
        await Bun.sleep(200)                             // 固定延迟用于验证两个工具并行
        return new Response('SLOW_OK')                   // 返回 Web 工具可读取文本
      }
      if (url.pathname === '/web-ok') return new Response('WEB_OK') // 返回 Web 工具成功文本
      if (url.pathname === '/web-error') return new Response('WEB_ERROR', { status: 503 }) // 返回 Web 工具错误状态

      const body = await request.json()                  // 读取真实 OpenAI-compatible 请求
      modelRequests.push(body)                           // 保存工具定义和消息供断言
      const prompt = JSON.stringify(body.messages)      // 简单识别测试消息，不参与生产代码
      if (prompt.includes('RETRY_FOREVER')) return Response.json({ error: { message: 'temporary outage' } }, { status: 500 }) // 持续可重试错误
      if (prompt.includes('RETRY_ONCE') && retryOnceFailures++ === 0) return Response.json({ error: { message: 'temporary once' } }, { status: 500 }) // 首次失败验证自动恢复
      if (prompt.includes('INVALID_REQUEST')) return Response.json({ error: { message: 'invalid request' } }, { status: 400 }) // 不可重试错误验证终态
      if (prompt.includes('SLOW_MODEL')) {
        await Bun.sleep(200)                             // 超过测试请求预算以触发超时重试
        return textStream('TOO_LATE')                    // 请求通常已由 Agent 中断
      }
      if (prompt.includes('STREAM_STOP')) return interruptedTextStream(request) // 输出首段文本后保持流打开，等待用户停止
      if (prompt.includes('SHELL_STOP')) return namedToolCallStream('call_sleep', 'shell', { command: process.platform === 'win32' ? 'Start-Sleep -Seconds 10' : 'sleep 10' }) // 启动可验证停止的长进程
      if (prompt.includes('REASONING_STREAM')) return reasoningStream() // 同轮返回思考和正文
      if (prompt.includes('TOOL_CHAIN')) {
        const hasToolResult = body.messages.some((message) => message.role === 'tool') // 工具结果出现后进入完成轮
        return hasToolResult
          ? toolCallStream()                             // 第二轮调用 finish 结束
          : namedToolCallStream('call_write', 'write_file', { path: 'chain.txt', content: 'CHAIN_OK' }) // 第一轮写入真实文件
      }
      if (prompt.includes('FINISH_TOOL')) return toolCallStream() // 返回 finish 工具调用

      const completedRounds = body.messages.filter((message) => message.role === 'assistant').length // 根据上下文确定当前纯文本轮次
      return textStream(`ROUND_${completedRounds + 1}`)  // 三轮分别返回稳定文本
    },
  })

  dataDirectory = await mkdtemp(join(tmpdir(), 'agent-minimal-')) // 创建隔离 .agent 根目录
  const created = await createApp({ dataDirectory })     // 使用正式启动流程创建应用
  app = created.app                                      // 保存 HTTP 请求入口
  closeApp = created.close                               // 保存统一资源清理动作
})


// --- 释放所有测试资源 ---
afterAll(async () => {
  await closeApp?.()                                     // 停止后台执行并关闭 SSE
  modelServer?.stop(true)                                // 关闭本机模型服务
  await rm(dataDirectory, { recursive: true, force: true }) // 删除隔离持久化数据
})


// --- 创建文本模型流 ---
function textStream(text) {
  const frames = [
    completionFrame({ role: 'assistant', content: text }, null), // 返回文本增量
    completionFrame({}, 'stop'),                       // 正常结束本轮
    'data: [DONE]\n\n',                               // 关闭 OpenAI-compatible 流
  ]
  return new Response(frames.join(''), { headers: { 'content-type': 'text/event-stream' } }) // 交给 AI SDK 真实解析
}


// --- 创建工具调用模型流 ---
function toolCallStream() {
  return namedToolCallStream('call_finish', 'finish', { summary: 'DONE' }) // 使用通用工具流返回完成调用
}


// --- 创建指定工具调用模型流 ---
function namedToolCallStream(id, name, input) {
  const toolCall = {
    role: 'assistant',                                  // 首个增量声明助手角色
    tool_calls: [{
      index: 0,                                         // 当前响应中的第一个工具调用
      id,                                               // 工具结果匹配使用的稳定 ID
      type: 'function',                                 // OpenAI-compatible 函数工具类型
      function: { name, arguments: JSON.stringify(input) }, // 请求 Agent 执行指定工具
    }],
  }
  const frames = [
    completionFrame(toolCall, null),                    // 输出完整工具调用增量
    completionFrame({}, 'tool_calls'),                  // 以工具调用原因结束模型轮次
    'data: [DONE]\n\n',                               // 关闭流
  ]
  return new Response(frames.join(''), { headers: { 'content-type': 'text/event-stream' } }) // 交给 AI SDK 真实解析
}


// --- 创建思考和正文模型流 ---
function reasoningStream() {
  const frames = [
    completionFrame({ role: 'assistant', reasoning_content: 'THINKING' }, null), // 先输出思考增量
    completionFrame({ content: 'ANSWER' }, null),       // 再输出可见正文
    completionFrame({}, 'stop'),                        // 正常结束本轮
    'data: [DONE]\n\n',                                // 关闭 OpenAI-compatible 流
  ]
  return new Response(frames.join(''), { headers: { 'content-type': 'text/event-stream' } }) // 交给 AI SDK 真实解析
}


// --- 创建等待用户停止的模型流 ---
function interruptedTextStream(request) {
  const firstFrame = completionFrame({ role: 'assistant', content: 'PARTIAL' }, null) // 先输出可被客户端观察的真实文本
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(firstFrame)) // 首段到达后保持连接打开，不发送结束帧
      request.signal.addEventListener('abort', () => {
        interruptedStreams += 1                          // AI SDK 中止底层请求后记录真实网络信号
        try { controller.close() } catch {}              // 释放本机测试响应流
      }, { once: true })
    },
  })
  return new Response(stream, { headers: { 'content-type': 'text/event-stream' } }) // 使用正式模型 SSE 协议
}


// --- 编码模型流帧 ---
function completionFrame(delta, finishReason) {
  return `data: ${JSON.stringify({
    id: crypto.randomUUID(),                            // 每个测试帧使用独立响应 ID
    object: 'chat.completion.chunk',                    // 声明 Chat Completions 流事件
    created: 1,                                         // 使用稳定测试时间
    model: 'unit-model',                                // 回显测试模型名
    choices: [{ index: 0, delta, finish_reason: finishReason }], // 输出当前增量和结束原因
  })}\n\n`
}


// --- 发送普通 HTTP 请求 ---
function request(path, options = {}) {
  return app.handle(new Request(`http://localhost${path}`, options)) // 全部断言经过真实路由
}


// --- 发送 JSON 请求 ---
function jsonRequest(path, method, body) {
  return request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) // 统一序列化请求体
}


// --- 建立 SSE 读取器 ---
async function subscribe(sessionId) {
  const response = await request(`/session/events?id=${sessionId}`) // 订阅指定会话
  expect(response.status).toBe(200)                    // SSE 路由必须成功建立
  return { reader: response.body.getReader(), pending: '', events: [] } // 保存跨批次解析状态
}


// --- 等待匹配的 SSE 事件 ---
async function readUntil(subscription, predicate, timeout = 10000) {
  const deadline = Date.now() + timeout                 // 防止实现错误导致测试永久等待
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now()            // 计算本次读取可等待时间
    const result = await Promise.race([
      subscription.reader.read(),                       // 等待下一批 SSE 字节
      Bun.sleep(remaining).then(() => ({ timeout: true })), // 到期后主动结束等待
    ])
    if (result.timeout) throw new Error('timed out waiting for SSE event') // 超时反馈明确测试错误
    if (result.done) throw new Error('SSE stream closed before expected event') // 提前关闭说明会话生命周期错误
    subscription.pending += new TextDecoder().decode(result.value, { stream: true }) // 合并跨批次文本
    const frames = subscription.pending.split('\n\n') // 标准 SSE 使用空行分隔帧
    subscription.pending = frames.pop() ?? ''           // 未完成帧留给下一批
    for (const frame of frames) {
      const name = frame.match(/^event: (.+)$/m)?.[1]   // 读取事件名称
      const data = frame.match(/^data: (.+)$/m)?.[1]    // 读取 JSON 正文
      if (!name || !data) continue                      // 忽略空帧
      const event = { name, data: JSON.parse(data) }    // 解析可断言事件
      subscription.events.push(event)                   // 保存完整已读时间线
      if (predicate(event)) return event                // 找到目标后立即反馈
    }
  }
  throw new Error('timed out waiting for SSE event')    // 循环到期时反馈超时
}


// --- 关闭 SSE 订阅 ---
async function unsubscribe(subscription) {
  await subscription.reader.cancel()                   // 主动触发 Session.listen 的 cancel 清理
}


describe('minimal agent backend', () => {
  let workspaceId                                      // 保存工作区供会话测试复用

  it('uses the exact minimal store shape and tool list', () => {
    expect(Object.keys(store).sort()).toEqual(['config', 'sessions', 'tools', 'workspaces']) // tools 与 config 并列且根节点没有额外领域
    expect(Object.keys(store.config)).toEqual(['provider']) // config 只包含持久化供应商
    expect(Object.keys(store.config.provider).sort()).toEqual(['api', 'key', 'models']) // provider 结构严格匹配设计
    expect(Array.isArray(store.tools)).toBe(true)        // 启动扫描结果必须是列表
    expect(store.tools.length).toBeGreaterThan(0)        // 内置工具必须在启动时被发现
    for (const tool of store.tools) expect(Object.keys(tool).sort()).toEqual(['description', 'inputSchema', 'name']) // 每项只保存 LLM 工具信息
  })

  it('flushes an SSE connection before the first business event', async () => {
    const directory = await mkdtemp(join(dataDirectory, 'sse-workspace-')) // 使用独立目录避免占用后续主工作区
    const workspace = await (await jsonRequest('/workspace', 'POST', { path: directory })).json() // 创建独立 SSE 测试工作区
    const session = await (await jsonRequest('/session', 'POST', { workspaceId: workspace.id, provider: 'unit', model: 'unit-model' })).json() // 创建独立 SSE 会话
    const response = await request(`/session/events?id=${session.id}`) // 建立尚未执行任务的 SSE 连接
    const reader = response.body.getReader()             // 读取首次网络数据
    const first = new TextDecoder().decode((await reader.read()).value) // 首帧必须立即可读
    expect(first).toBe(': connected\n\n')               // 注释帧只刷新连接，不伪造业务状态
    await reader.cancel()                                 // 释放 SSE 客户端
  })

  it('exposes minimal health and persists raw config', async () => {
    expect(await (await request('/health')).json()).toEqual({ status: 'ok' }) // 健康接口不增加版本或引擎字段
    const patched = await jsonRequest('/config', 'PATCH', {
      provider: {
        api: `http://127.0.0.1:${modelServer.port}/v1`, // 指向本机模型端点
        key: 'unit-secret',                             // 使用可验证原始 Key
        models: ['unit-model'],                         // 声明可选测试模型
      },
    })
    expect(patched.status).toBe(200)                    // 配置更新成功
    const config = await patched.json()                 // 读取完整更新结果
    expect(config.provider.key).toBe('unit-secret')     // API Key 不脱敏
    expect(config.tools).toBeUndefined()                // 工具不属于配置响应
    const saved = JSON.parse(await readFile(join(dataDirectory, 'config.json'), 'utf8')) // 读取真实配置文件
    expect(saved).toEqual(config)                       // 磁盘结构与 store.config 完全相同

    const unrelated = await jsonRequest('/config', 'PATCH', { tools: {} }) // 额外领域不参与供应商配置
    expect(unrelated.status).toBe(200)                  // command 默认信任输入并只读取所需字段
    expect(await (await request('/config')).json()).toEqual(config) // 无关字段不进入配置
  })

  it('reports missing routes and business resources', async () => {
    expect((await request('/missing-route')).status).toBe(404) // 未注册路由返回明确资源错误
    expect((await request('/session?id=missing')).status).toBe(404) // 未知会话不能读取
    expect((await request('/session/events?id=missing')).status).toBe(404) // 未知会话不能订阅
    expect((await jsonRequest('/session', 'POST', { workspaceId: 'missing', model: 'unit-model' })).status).toBe(404) // 未知工作区不能创建会话
    expect((await jsonRequest('/session/send', 'POST', { id: 'missing', content: 'hello' })).status).toBe(404) // 未知会话不能发送
    expect((await jsonRequest('/session/stop', 'POST', { id: 'missing' })).status).toBe(404) // 未知会话不能停止
  })

  it('serializes concurrent config updates without losing fields', async () => {
    const [apiUpdate, keyUpdate, modelsUpdate] = await Promise.all([
      jsonRequest('/config', 'PATCH', { provider: { api: `http://127.0.0.1:${modelServer.port}/v1` } }), // 并发更新 API
      jsonRequest('/config', 'PATCH', { provider: { key: 'concurrent-secret' } }), // 并发更新 Key
      jsonRequest('/config', 'PATCH', { provider: { models: ['unit-model', 'backup-model'] } }), // 并发更新模型列表
    ])
    expect([apiUpdate.status, keyUpdate.status, modelsUpdate.status]).toEqual([200, 200, 200]) // 三个修改都被接受
    const config = await (await request('/config')).json() // 读取全部排队修改后的状态
    expect(config.provider).toEqual({ api: `http://127.0.0.1:${modelServer.port}/v1`, key: 'concurrent-secret', models: ['unit-model', 'backup-model'] }) // 不丢失任何字段
    expect(JSON.parse(await readFile(join(dataDirectory, 'config.json'), 'utf8'))).toEqual(config) // 磁盘与内存保持一致
    await jsonRequest('/config', 'PATCH', { provider: { key: 'unit-secret', models: ['unit-model'] } }) // 恢复后续模型测试配置
  })

  it('migrates tools out of an old config file on startup', async () => {
    const migrationRoot = await mkdtemp(join(dataDirectory, 'config-migration-')) // 创建旧配置隔离目录
    const oldConfig = {
      provider: { api: 'https://example.invalid/v1', key: 'old-key', models: ['old-model'] }, // 保留供应商配置
      tools: [{ name: 'old-tool', description: 'obsolete', inputSchema: { type: 'object' } }], // 模拟旧版持久化工具
    }
    await Bun.write(join(migrationRoot, 'config.json'), `${JSON.stringify(oldConfig)}\n`) // 写入真实旧格式文件
    const migrated = await createApp({ dataDirectory: migrationRoot }) // 启动流程执行自动迁移
    try {
      const config = await migrated.app.handle(new Request('http://localhost/config')).then((response) => response.json()) // 读取迁移后配置
      expect(config).toEqual({ provider: oldConfig.provider }) // 供应商数据完整保留
      expect(JSON.parse(await readFile(join(migrationRoot, 'config.json'), 'utf8'))).toEqual(config) // 磁盘删除旧 tools 字段
      expect(store.tools.some((tool) => tool.name === 'read_file')).toBe(true) // 工具仍来自正式目录扫描
    } finally {
      await migrated.close()                             // 关闭迁移应用
      const restored = await createApp({ dataDirectory }) // 恢复主测试应用的全局 store
      app = restored.app                                 // 后续测试继续使用主数据目录
      closeApp = restored.close                          // afterAll 关闭恢复后的应用
    }
  })

  it('discovers tools from a supplied startup directory', async () => {
    const dynamicRoot = await mkdtemp(join(dataDirectory, 'dynamic-tools-')) // 创建动态工具应用数据目录
    const toolsDirectory = join(dynamicRoot, 'tools')    // 创建本次启动专属工具目录
    await mkdir(toolsDirectory, { recursive: true })     // 确保扫描目录存在
    await Bun.write(join(toolsDirectory, 'custom.js'), [
      'const customTool = {',                            // 定义最小合法动态工具
      "  name: 'custom_echo',",
      "  description: 'Echo dynamic input.',",
      "  parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },",
      '  async execute({ text }) { return { output: text } },',
      '}',
      'export default customTool',
      '',
    ].join('\n'))
    const dynamic = await createApp({ dataDirectory: dynamicRoot, toolsDirectory }) // 启动时只扫描临时工具
    try {
      expect(store.tools).toEqual([{ name: 'custom_echo', description: 'Echo dynamic input.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } }]) // store 反映动态目录
      expect(Tool.list()).toEqual(store.tools)           // 指令公开列表与 store 一致
    } finally {
      await dynamic.close()                              // 关闭动态工具应用
      const restored = await createApp({ dataDirectory }) // 恢复正式工具目录和主测试数据
      app = restored.app                                 // 后续测试继续使用恢复入口
      closeApp = restored.close                          // afterAll 关闭恢复应用
    }
  })

  it('uses one stable definition for duplicate tool names', async () => {
    const duplicateRoot = await mkdtemp(join(dataDirectory, 'duplicate-tools-')) // 创建重复工具隔离目录
    const toolsDirectory = join(duplicateRoot, 'tools')  // 创建本次启动专属工具目录
    await mkdir(toolsDirectory, { recursive: true })     // 确保扫描目录存在
    const source = "export default { name: 'duplicate', description: 'duplicate', parameters: { type: 'object' }, async execute() { return { output: 'ok' } } }\n" // 两个文件默认导出同名合法工具
    await Promise.all([
      Bun.write(join(toolsDirectory, 'first.js'), source), // 写入第一个同名工具
      Bun.write(join(toolsDirectory, 'second.js'), source), // 写入第二个同名工具
    ])
    const duplicate = await createApp({ dataDirectory: duplicateRoot, toolsDirectory }) // 默认信任工具模块并完成启动
    try {
      expect(store.tools).toEqual([{ name: 'duplicate', description: 'duplicate', inputSchema: { type: 'object' } }]) // 同名定义只占一个注册位置
    } finally {
      await duplicate.close()                            // 关闭重复工具应用
      const restored = await createApp({ dataDirectory }) // 恢复正式工具目录和主测试数据
      app = restored.app                                 // 后续测试继续使用恢复入口
      closeApp = restored.close                          // afterAll 关闭恢复应用
    }
  })

  it('manages workspace and session persistence through the minimal API', async () => {
    const workspaceResponse = await jsonRequest('/workspace', 'POST', { path: dataDirectory }) // 添加真实目录工作区
    expect(workspaceResponse.status).toBe(200)          // 工作区创建成功
    const workspace = await workspaceResponse.json()   // 读取新工作区
    workspaceId = workspace.id                         // 保存后续会话归属
    expect(workspace).toEqual({ id: expect.any(String), path: dataDirectory, sessions: [] }) // 工作区没有额外字段

    const sessionResponse = await jsonRequest('/session', 'POST', { workspaceId, provider: 'unit', model: 'unit-model' }) // 创建最小会话
    expect(sessionResponse.status).toBe(200)            // 会话创建成功
    const session = await sessionResponse.json()        // 读取会话持久化字段
    expect(session).toEqual({ id: expect.any(String), status: 'idle', messages: [], provider: 'unit', model: 'unit-model' }) // 响应不含运行时字段

    const renamed = await jsonRequest('/session', 'PATCH', { id: session.id, title: '测试会话' }) // 只修改摘要标题
    expect(renamed.status).toBe(200)                    // 标题修改成功
    const workspaces = await (await request('/workspace')).json() // 重新读取工作区摘要
    const summary = workspaces.find((item) => item.id === workspaceId).sessions.find((item) => item.id === session.id) // 按身份定位目标摘要
    expect(summary).toMatchObject({ id: session.id, title: '测试会话', lastActiveAt: expect.any(Number) }) // 摘要包含严格三个字段

    const detail = await (await request(`/session?id=${session.id}`)).json() // 按 query id 读取会话
    expect(detail).toEqual(session)                     // 修改标题不向完整 session 添加 title
    const savedSession = JSON.parse(await readFile(join(dataDirectory, 'sessions', `${session.id}.json`), 'utf8')) // 读取真实会话文件
    expect(savedSession).toEqual(session)               // 会话文件不持久化四个运行字段
  })

  it('protects workspace and session ownership conflicts', async () => {
    const duplicate = await jsonRequest('/workspace', 'POST', { path: dataDirectory }) // 尝试重复添加同一路径
    expect(duplicate.status).toBe(409)                  // 路径大小写归一后保持唯一
    const session = await (await jsonRequest('/session', 'POST', { workspaceId, provider: 'unit', model: 'unit-model' })).json() // 创建独立验证会话
    expect((await request(`/workspace?id=${workspaceId}`, { method: 'DELETE' })).status).toBe(409) // 有会话的工作区不能被删除
    expect((await (await request(`/session?id=${session.id}`, { method: 'DELETE' })).json()).id).toBe(session.id) // 清理验证会话
  })

  it('shares one runtime object across concurrent cold session loads', async () => {
    const session = await (await jsonRequest('/session', 'POST', { workspaceId, provider: 'unit', model: 'unit-model' })).json() // 创建可从磁盘重新加载的会话
    store.sessions = store.sessions.filter((item) => item.id !== session.id) // 模拟进程尚未加载该会话
    const loaded = await Promise.all(Array.from({ length: 8 }, () => Session.getMutable(session.id))) // 同时触发多个首次读取
    expect(loaded.every((item) => item === loaded[0])).toBe(true) // 所有调用方必须共享 Set 和控制器所在对象
    expect(store.sessions.filter((item) => item.id === session.id)).toHaveLength(1) // store 中不能产生重复会话
  })

  it('rejects tools when a session has lost its workspace', async () => {
    const session = await (await jsonRequest('/session', 'POST', { workspaceId, provider: 'unit', model: 'unit-model' })).json() // 创建正常归属的会话
    const workspace = store.workspaces.find((item) => item.id === workspaceId) // 定位真实工作区摘要
    workspace.sessions = workspace.sessions.filter((summary) => summary.id !== session.id) // 模拟损坏数据中的孤立会话
    const outcome = await Tool.runAll(session.id, [
      { type: 'tool-call', toolCallId: 'orphan-read', toolName: 'read_file', input: { path: 'config.json' } }, // 尝试读取相对文件
    ])
    expect(outcome.results[0]).toEqual({ type: 'tool-result', toolCallId: 'orphan-read', toolName: 'read_file', output: { type: 'error-text', value: 'session workspace not found' } }) // 工具不能回退到服务端当前目录
    await Session.remove(session.id)                    // 清理不再属于工作区的测试会话
  })

  it('streams three text-only rounds and sends store.tools to the LLM', async () => {
    const session = await (await jsonRequest('/session', 'POST', { workspaceId, provider: 'unit', model: 'unit-model' })).json() // 创建独立执行会话
    const subscription = await subscribe(session.id)    // 发送前先建立 SSE 防止丢失实时事件
    const requestStart = modelRequests.length           // 记录本测试新增的模型请求边界
    const sent = await jsonRequest('/session/send', 'POST', { id: session.id, content: 'TEXT_ONLY' }) // 后台启动 Agent
    expect(await sent.json()).toEqual({ messageId: expect.any(String) }) // HTTP 立即返回用户消息 ID
    await readUntil(subscription, (event) => event.name === 'status' && event.data.status === 'idle') // 等待三轮结束

    const requests = modelRequests.slice(requestStart)  // 读取本会话三轮模型请求
    expect(requests).toHaveLength(3)                    // 第三次纯文本后才退出
    const sentTools = requests[0].tools.map((tool) => ({ name: tool.function.name, description: tool.function.description, inputSchema: tool.function.parameters })) // 读取协议实际发送的全部工具信息
    expect(sentTools).toEqual(store.tools)              // 名称、描述和输入 schema 逐项来自启动扫描结果
    const detail = await (await request(`/session?id=${session.id}`)).json() // 读取执行后的会话
    expect(detail.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'assistant', 'assistant']) // 保留三轮普通回复
    expect(detail.messages.at(-1).content).toEqual([{ type: 'text', text: 'ROUND_3' }]) // 持久化内容直接符合 AI SDK TextPart
    await unsubscribe(subscription)                     // 释放 SSE 客户端
  }, 15000)

  it('executes an LLM tool call and stores the tool result', async () => {
    const session = await (await jsonRequest('/session', 'POST', { workspaceId, provider: 'unit', model: 'unit-model' })).json() // 创建工具执行会话
    const subscription = await subscribe(session.id)    // 发送前建立 SSE
    await jsonRequest('/session/send', 'POST', { id: session.id, content: 'FINISH_TOOL' }) // 请求模型调用 finish
    await readUntil(subscription, (event) => event.name === 'status' && event.data.status === 'idle') // finish 工具结束循环

    expect(subscription.events.some((event) => event.name === 'tool-call' && event.data.toolCall.toolName === 'finish')).toBe(true) // SSE 展示工具调用
    expect(subscription.events.some((event) => event.name === 'tool-result' && event.data.toolResult.output.value === 'DONE')).toBe(true) // SSE 展示 AI SDK 工具结果
    const detail = await (await request(`/session?id=${session.id}`)).json() // 读取持久化上下文
    expect(detail.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool']) // 工具调用和结果形成两条消息
    expect(detail.messages[2].content[0]).toEqual({ type: 'tool-result', toolCallId: 'call_finish', toolName: 'finish', output: { type: 'text', value: 'DONE' } }) // 结果直接符合 AI SDK ToolResultPart
    await unsubscribe(subscription)                     // 释放 SSE 客户端
  }, 10000)

  it('streams reasoning and visible text in their store order', async () => {
    const session = await (await jsonRequest('/session', 'POST', { workspaceId, provider: 'unit', model: 'unit-model' })).json() // 创建思考流会话
    const subscription = await subscribe(session.id)    // 监听思考、正文和终态
    await jsonRequest('/session/send', 'POST', { id: session.id, content: 'REASONING_STREAM' }) // 请求模型返回思考内容
    await readUntil(subscription, (event) => event.name === 'status' && event.data.status === 'idle') // 等待三轮文本规则结束
    expect(subscription.events.some((event) => event.name === 'reasoning-delta' && event.data.text === 'THINKING')).toBe(true) // SSE 实时反馈 AI SDK 推理增量
    expect(subscription.events.some((event) => event.name === 'text-delta' && event.data.text === 'ANSWER')).toBe(true) // SSE 实时反馈正文
    const detail = await (await request(`/session?id=${session.id}`)).json() // 读取持久化输出顺序
    expect(detail.messages[1].content).toEqual([
      { type: 'reasoning', text: 'THINKING' },           // 推理块直接符合 AI SDK ReasoningPart
      { type: 'text', text: 'ANSWER' },                  // 正文块紧随其后
    ])
    await unsubscribe(subscription)                     // 释放 SSE 客户端
  }, 10000)

  it('continues after a tool result and lets finish end the chain', async () => {
    const directory = await mkdtemp(join(dataDirectory, 'tool-chain-')) // 创建独立真实工具工作区
    const workspace = await (await jsonRequest('/workspace', 'POST', { path: directory })).json() // 登记工具工作区
    const session = await (await jsonRequest('/session', 'POST', { workspaceId: workspace.id, provider: 'unit', model: 'unit-model' })).json() // 创建工具续轮会话
    const subscription = await subscribe(session.id)    // 监听两个工具轮次
    await jsonRequest('/session/send', 'POST', { id: session.id, content: 'TOOL_CHAIN' }) // 首轮写文件，次轮 finish
    await readUntil(subscription, (event) => event.name === 'status' && event.data.status === 'idle') // 等待 finish 结束
    expect(await readFile(join(directory, 'chain.txt'), 'utf8')).toBe('CHAIN_OK') // write_file 真实修改工作区
    const detail = await (await request(`/session?id=${session.id}`)).json() // 读取完整工具上下文
    expect(detail.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'tool']) // 工具结果确实发送到下一轮
    expect(detail.messages[2].content[0].output.value).toContain('chain.txt') // 第一轮保存写入反馈
    expect(detail.messages[4].content[0].output.value).toBe('DONE') // 第二轮 finish 保存摘要
    await unsubscribe(subscription)                     // 释放 SSE 客户端
  }, 10000)

  it('recovers after one retryable provider failure', async () => {
    retryOnceFailures = 0                               // 每次测试重新允许一次临时失败
    const session = await (await jsonRequest('/session', 'POST', { workspaceId, provider: 'unit', model: 'unit-model' })).json() // 创建重试恢复会话
    const subscription = await subscribe(session.id)    // 监听重试错误和最终状态
    await jsonRequest('/session/send', 'POST', { id: session.id, content: 'RETRY_ONCE' }) // 首次请求返回 500
    const retryEvent = await readUntil(subscription, (event) => event.name === 'error' && event.data.attempt === 1) // 等待退避反馈
    expect(retryEvent.data.nextRetryIn).toBeGreaterThanOrEqual(1000) // 使用正式退避预算
    await readUntil(subscription, (event) => event.name === 'status' && event.data.status === 'idle') // 后续请求恢复并完成
    expect((await (await request(`/session?id=${session.id}`)).json()).messages.length).toBe(4) // 恢复后仍遵循三轮文本规则
    await unsubscribe(subscription)                     // 释放 SSE 客户端
  }, 15000)

  it('marks a non-retryable provider error as final', async () => {
    const session = await (await jsonRequest('/session', 'POST', { workspaceId, provider: 'unit', model: 'unit-model' })).json() // 创建最终错误会话
    const subscription = await subscribe(session.id)    // 监听错误终态
    const requestStart = modelRequests.length           // 记录本测试请求边界
    await jsonRequest('/session/send', 'POST', { id: session.id, content: 'INVALID_REQUEST' }) // 触发供应商 400
    await readUntil(subscription, (event) => event.name === 'status' && event.data.status === 'error') // 不可重试错误进入 error
    expect(modelRequests.slice(requestStart)).toHaveLength(1) // 400 只请求一次
    expect((await (await request(`/session?id=${session.id}`)).json()).status).toBe('error') // 错误状态持久化
    await unsubscribe(subscription)                     // 释放 SSE 客户端
  }, 10000)

  it('runs every tool call in the same turn concurrently', async () => {
    const session = await (await jsonRequest('/session', 'POST', { workspaceId, provider: 'unit', model: 'unit-model' })).json() // 创建工具运行上下文
    const startedAt = Date.now()                        // 记录两个固定延迟请求的总耗时
    const result = await Tool.runAll(session.id, [
      { type: 'tool-call', toolCallId: 'web-1', toolName: 'web', input: { url: `http://127.0.0.1:${modelServer.port}/slow` } }, // 第一个慢请求
      { type: 'tool-call', toolCallId: 'web-2', toolName: 'web', input: { url: `http://127.0.0.1:${modelServer.port}/slow` } }, // 第二个慢请求
    ])
    expect(Date.now() - startedAt).toBeLessThan(350)    // 并行约 200ms，串行约 400ms
    expect(result.results.map((item) => item.output.value)).toEqual(['SLOW_OK', 'SLOW_OK']) // 结果保持调用顺序
  })

  it('executes every built-in tool through the command boundary', async () => {
    const directory = await mkdtemp(join(dataDirectory, 'all-tools-')) // 创建隔离工具工作区
    await mkdir(join(directory, 'nested'), { recursive: true }) // 创建搜索所需子目录
    const workspace = await (await jsonRequest('/workspace', 'POST', { path: directory })).json() // 登记真实工具目录
    const session = await (await jsonRequest('/session', 'POST', { workspaceId: workspace.id, provider: 'unit', model: 'unit-model' })).json() // 创建工具上下文

    const overwrite = await Tool.runAll(session.id, [
      { type: 'tool-call', toolCallId: 'write-overwrite', toolName: 'write_file', input: { path: 'nested/note.txt', content: 'A' } }, // 覆盖创建文件
    ])
    const append = await Tool.runAll(session.id, [
      { type: 'tool-call', toolCallId: 'write-append', toolName: 'write_file', input: { path: 'nested/note.txt', content: 'B', mode: 'append' } }, // 追加文件
    ])
    const reads = await Tool.runAll(session.id, [
      { type: 'tool-call', toolCallId: 'read', toolName: 'read_file', input: { path: 'nested/note.txt' } }, // 读取完整文本
      { type: 'tool-call', toolCallId: 'list', toolName: 'list_files', input: { path: 'nested' } }, // 列出当前目录
      { type: 'tool-call', toolCallId: 'search', toolName: 'search_files', input: { path: '.', keyword: 'note' } }, // 递归搜索文件名
      { type: 'tool-call', toolCallId: 'web-ok', toolName: 'web', input: { url: `http://127.0.0.1:${modelServer.port}/web-ok` } }, // 获取成功网页
      { type: 'tool-call', toolCallId: 'web-error', toolName: 'web', input: { url: `http://127.0.0.1:${modelServer.port}/web-error` } }, // 获取错误网页
      { type: 'tool-call', toolCallId: 'finish', toolName: 'finish', input: { summary: 'TOOLS_DONE' } }, // 明确结束任务
      { type: 'tool-call', toolCallId: 'missing', toolName: 'missing_tool', input: {} }, // 未配置工具返回错误
    ])
    const shell = await Tool.runAll(session.id, [
      { type: 'tool-call', toolCallId: 'shell-ok', toolName: 'shell', input: { command: process.platform === 'win32' ? "[Console]::Write('SHELL_OK')" : "printf 'SHELL_OK'", cwd: 'nested' } }, // 在相对工作目录执行成功命令
    ])

    expect(overwrite.results[0].output.type).toBe('text') // 覆盖写入成功
    expect(append.results[0].output.type).toBe('text')   // 追加写入成功
    expect(reads.results[0].output.value).toBe('AB')    // 读取返回覆盖和追加后的完整内容
    expect(reads.results[1].output.value).toContain('file: note.txt') // 目录列出真实文件
    expect(reads.results[2].output.value).toContain(join('nested', 'note.txt')) // 搜索返回真实路径
    expect(reads.results[3].output.value).toBe('WEB_OK') // Web 成功内容返回模型
    expect(reads.results[4].output).toEqual({ type: 'error-text', value: 'web request failed with status 503' }) // Web 非成功状态变成错误结果
    expect(reads.results[5].output).toEqual({ type: 'text', value: 'TOOLS_DONE' }) // finish 返回摘要
    expect(reads.shouldStop).toBe(true)                 // finish 控制 Agent 退出
    expect(reads.results[6].output).toEqual({ type: 'error-text', value: 'tool not found: missing_tool' }) // 未声明工具不执行
    expect(shell.results[0].output.value).toMatchObject({ stdout: 'SHELL_OK', exitCode: 0 }) // Shell 使用工作区相对 cwd
  }, 10000)

  it('broadcasts one event to every SSE client and cleans disconnects', async () => {
    const session = await (await jsonRequest('/session', 'POST', { workspaceId, provider: 'unit', model: 'unit-model' })).json() // 创建多客户端会话
    const first = await subscribe(session.id)           // 建立第一个 SSE 客户端
    const second = await subscribe(session.id)          // 建立第二个 SSE 客户端
    Session.emit(session.id, 'status', { status: 'manual-check' }) // 直接通过正式反馈指令广播
    const [firstEvent, secondEvent] = await Promise.all([
      readUntil(first, (event) => event.name === 'status'), // 第一个客户端读取同一事件
      readUntil(second, (event) => event.name === 'status'), // 第二个客户端读取同一事件
    ])
    expect(firstEvent.data).toEqual({ status: 'manual-check' }) // 第一个客户端数据完整
    expect(secondEvent.data).toEqual({ status: 'manual-check' }) // 第二个客户端数据完整
    await Promise.all([unsubscribe(first), unsubscribe(second)]) // 同时断开两个客户端
    expect((await Session.getMutable(session.id)).clients.size).toBe(0) // cancel 清理全部控制器引用
  })

  it('marks a non-zero shell exit as an error result', async () => {
    const session = await (await jsonRequest('/session', 'POST', { workspaceId, provider: 'unit', model: 'unit-model' })).json() // 创建 Shell 工具上下文
    const command = process.platform === 'win32' ? 'exit 7' : 'exit 7' // 两个平台都使用非零退出命令
    const result = await Tool.runAll(session.id, [
      { type: 'tool-call', toolCallId: 'shell-error', toolName: 'shell', input: { command } }, // 执行必定失败的命令
    ])
    expect(result.results[0].output.type).toBe('error-text') // 非零退出码不能伪装成成功工具结果
    expect(result.results[0].output.value).toContain('exitCode') // 错误仍保留输出和退出码供模型修正
  })

  it('keeps retrying recoverable errors until stop aborts the wait', async () => {
    const session = await (await jsonRequest('/session', 'POST', { workspaceId, provider: 'unit', model: 'unit-model' })).json() // 创建无限重试会话
    const subscription = await subscribe(session.id)    // 建立错误和状态事件监听
    await jsonRequest('/session/send', 'POST', { id: session.id, content: 'RETRY_FOREVER' }) // 触发持续 500 错误
    await readUntil(subscription, (event) => event.name === 'error') // 确认已经进入重试退避
    const controller = (await Session.getMutable(session.id)).abortController // 读取本轮标准停止控制器
    expect(Object.hasOwn(controller, 'finished')).toBe(false) // 后台完成时刻不能污染 AbortController
    const stopped = await jsonRequest('/session/stop', 'POST', { id: session.id }) // 在退避期间停止
    expect(await stopped.json()).toEqual({ status: 'idle' }) // stop 立即恢复空闲
    await readUntil(subscription, (event) => event.name === 'status' && event.data.status === 'idle') // SSE 同步反馈停止
    expect((await (await request(`/session?id=${session.id}`)).json()).status).toBe('idle') // 会话最终持久化为空闲
    await unsubscribe(subscription)                     // 释放 SSE 客户端
  }, 10000)

  it('aborts an active LLM stream and discards its partial assistant message', async () => {
    const configured = await jsonRequest('/config', 'PATCH', { provider: { api: `http://127.0.0.1:${modelServer.port}/v1`, key: 'unit-secret', models: ['unit-model'] } }) // 独立运行时也配置本机模型
    expect(configured.status).toBe(200)                  // 模型端点配置成功
    const directory = await mkdtemp(join(dataDirectory, 'stream-stop-')) // 创建可独立运行的测试工作区
    const workspace = await (await jsonRequest('/workspace', 'POST', { path: directory })).json() // 登记本测试专属工作区
    const session = await (await jsonRequest('/session', 'POST', { workspaceId: workspace.id, provider: 'unit', model: 'unit-model' })).json() // 创建流式中断会话
    const subscription = await subscribe(session.id)    // 监听首段文本和停止终态
    const abortCountBefore = interruptedStreams         // 记录本测试开始前的网络中断次数
    const sent = await jsonRequest('/session/send', 'POST', { id: session.id, content: 'STREAM_STOP' }) // 让模型输出首段后保持连接
    expect(sent.status).toBe(200)                        // Agent 已经成功进入流式请求
    const partial = await readUntil(subscription, (event) => event.name === 'text-delta' && event.data.text === 'PARTIAL') // 确认 Agent 正在消费真实流
    const mutable = await Session.getMutable(session.id) // 读取本轮实际控制器
    const controller = mutable.abortController           // 保存停止前的控制器引用供事后断言
    expect(partial.data.messageId).toBeString()          // 首段文本已经获得本轮助手消息身份
    expect(controller.signal.aborted).toBe(false)        // 停止前请求仍在活跃读取

    const stoppedAt = Date.now()                         // 记录流式中断耗时
    const stopped = await jsonRequest('/session/stop', 'POST', { id: session.id }) // 通过正式停止接口中断 LLM
    expect(await stopped.json()).toEqual({ status: 'idle' }) // 停止完成后会话恢复空闲
    expect(Date.now() - stoppedAt).toBeLessThan(1000)    // 不等待模型流或请求超时自然结束
    expect(controller.signal.aborted).toBe(true)         // 原始控制器确实收到 abort
    expect(mutable.abortController).toBeNull()           // Agent finally 已释放会话控制器
    expect(interruptedStreams).toBe(abortCountBefore + 1) // 中断已经传递到模型服务的 Request.signal
    const detail = await (await request(`/session?id=${session.id}`)).json() // 读取停止后的持久化会话
    expect(detail.messages.map((message) => message.role)).toEqual(['user']) // 未完成助手消息不能进入历史
    expect(detail.messages.some((message) => message.id === partial.data.messageId)).toBe(false) // 流式临时身份没有残留
    await unsubscribe(subscription)                     // 释放 SSE 客户端
  }, 10000)

  it('times out a hanging model request and remains stoppable', async () => {
    const previousTimeout = process.env.AGENT_REQUEST_TIMEOUT_MS // 保存外部测试环境原值
    process.env.AGENT_REQUEST_TIMEOUT_MS = '30'          // 使用短预算触发至少一次真实超时
    try {
      const session = await (await jsonRequest('/session', 'POST', { workspaceId, provider: 'unit', model: 'unit-model' })).json() // 创建超时会话
      const subscription = await subscribe(session.id)  // 监听超时重试
      await jsonRequest('/session/send', 'POST', { id: session.id, content: 'SLOW_MODEL' }) // 模型响应超过单次预算
      const timeoutEvent = await readUntil(subscription, (event) => event.name === 'error' && event.data.message.includes('timed out')) // 等待超时反馈
      expect(timeoutEvent.data.attempt).toBe(1)          // 首次超时进入第一轮退避
      expect(await (await jsonRequest('/session/stop', 'POST', { id: session.id })).json()).toEqual({ status: 'idle' }) // 退避期间可立即停止
      await unsubscribe(subscription)                   // 释放 SSE 客户端
    } finally {
      if (previousTimeout === undefined) delete process.env.AGENT_REQUEST_TIMEOUT_MS // 恢复未设置状态
      else process.env.AGENT_REQUEST_TIMEOUT_MS = previousTimeout // 恢复调用方原值
    }
  }, 10000)

  it('kills a running shell process when the Agent stops', async () => {
    const session = await (await jsonRequest('/session', 'POST', { workspaceId, provider: 'unit', model: 'unit-model' })).json() // 创建长 Shell 会话
    const subscription = await subscribe(session.id)    // 监听工具调用和停止终态
    await jsonRequest('/session/send', 'POST', { id: session.id, content: 'SHELL_STOP' }) // 让模型启动十秒子进程
    await readUntil(subscription, (event) => event.name === 'tool-call' && event.data.toolCall.toolName === 'shell') // 确认模型已经声明 Shell
    const mutable = await Session.getMutable(session.id) // 读取真实工具进程集合
    const deadline = Date.now() + 3000                   // 等待工具进程实际加入 store
    while (mutable.processes.size === 0 && Date.now() < deadline) await Bun.sleep(10) // 模型消息保存后工具才启动
    expect(mutable.processes.size).toBe(1)              // 长 Shell 已由会话追踪
    const stoppedAt = Date.now()                         // 记录停止耗时
    expect(await (await jsonRequest('/session/stop', 'POST', { id: session.id })).json()).toEqual({ status: 'idle' }) // 中断模型和进程
    expect(Date.now() - stoppedAt).toBeLessThan(3000)   // 不等待原始十秒命令自然结束
    expect(mutable.processes.size).toBe(0)              // 子进程引用已清空
    await unsubscribe(subscription)                     // 释放 SSE 客户端
  }, 10000)

  it('falls back to the default model timeout for invalid environment values', async () => {
    const previousTimeout = process.env.AGENT_REQUEST_TIMEOUT_MS // 保存外部测试环境原值
    process.env.AGENT_REQUEST_TIMEOUT_MS = 'invalid'     // 模拟错误环境配置
    try {
      const session = await (await jsonRequest('/session', 'POST', { workspaceId, provider: 'unit', model: 'unit-model' })).json() // 创建正常完成会话
      const subscription = await subscribe(session.id)  // 监听 finish 终态
      await jsonRequest('/session/send', 'POST', { id: session.id, content: 'FINISH_TOOL' }) // 非法环境值不能阻止请求
      await readUntil(subscription, (event) => event.name === 'status' && event.data.status === 'idle') // 正常完成证明使用默认预算
      await unsubscribe(subscription)                   // 释放 SSE 客户端
    } finally {
      if (previousTimeout === undefined) delete process.env.AGENT_REQUEST_TIMEOUT_MS // 恢复未设置状态
      else process.env.AGENT_REQUEST_TIMEOUT_MS = previousTimeout // 恢复调用方原值
    }
  }, 10000)

  it('does not impose a retry count limit', async () => {
    let attempts = 0                                    // 记录操作真实执行次数
    const result = await Retry.run(async () => {
      attempts += 1                                     // 每次进入操作都递增
      if (attempts < 6) throw Object.assign(new Error('temporary'), { status: 500 }) // 连续五次可重试失败
      return 'recovered'                                // 第六次成功结束无限循环
    }, { baseDelay: 0 })                                // 测试不等待真实退避时间
    expect(result).toBe('recovered')                    // 超过旧三次预算后仍可成功
    expect(attempts).toBe(6)                            // 没有隐藏重试次数上限
  })

  it('does not retry protocol or explicitly final errors', async () => {
    let protocolAttempts = 0                            // 记录普通代码或协议错误执行次数
    const protocolFailure = Retry.run(async () => {
      protocolAttempts += 1                             // 每次进入操作都递增
      throw new Error('invalid stream protocol')        // 无网络标记的错误必须立即失败
    }, { baseDelay: 0 })
    await expect(protocolFailure).rejects.toThrow('invalid stream protocol') // 错误原样交给调用方
    expect(protocolAttempts).toBe(1)                    // 未分类错误不能被无限吞掉

    let conflictAttempts = 0                            // 记录不在项目恢复范围内的 HTTP 冲突
    const conflictFailure = Retry.run(async () => {
      conflictAttempts += 1                             // 每次进入操作都递增
      throw Object.assign(new Error('request conflict'), { status: 409, isRetryable: true }) // SDK 默认可能认为冲突可重试
    }, { baseDelay: 0 })
    await expect(conflictFailure).rejects.toThrow('request conflict') // 项目重试规则优先于 SDK 宽松默认值
    expect(conflictAttempts).toBe(1)                    // HTTP 409 不进入无限重试
  })

  it('rejects sends until an error session is explicitly stopped', async () => {
    const session = await (await jsonRequest('/session', 'POST', { workspaceId, provider: 'unit', model: 'unit-model' })).json() // 创建状态控制会话
    const mutable = store.sessions.find((item) => item.id === session.id) // 测试直接模拟不可重试错误结束状态
    mutable.status = 'error'                              // error 不是可直接发送的空闲状态
    const rejected = await jsonRequest('/session/send', 'POST', { id: session.id, content: '不能直接发送' }) // 尝试绕过停止恢复
    expect(rejected.status).toBe(409)                     // 非 idle 会话必须拒绝新 Agent
    expect(await (await jsonRequest('/session/stop', 'POST', { id: session.id })).json()).toEqual({ status: 'idle' }) // 显式停止恢复空闲
  })

  it('serializes session and workspace snapshots under rapid updates', async () => {
    const session = await (await jsonRequest('/session', 'POST', { workspaceId, provider: 'unit', model: 'unit-model' })).json() // 创建并发更新会话
    const updates = Array.from({ length: 20 }, (_, index) => jsonRequest('/session', 'PATCH', {
      id: session.id,                                    // 所有请求修改同一完整会话
      title: `title-${index}`,                           // 同时修改工作区摘要
      provider: `provider-${index}`,                     // 修改会话供应商字段
      model: `model-${index}`,                           // 修改会话模型字段
    }))
    const responses = await Promise.all(updates)         // 并发发出并等待全部业务保存
    expect(responses.every((response) => response.status === 200)).toBe(true) // 所有更新完成
    const currentSession = await (await request(`/session?id=${session.id}`)).json() // 读取内存最终状态
    const currentWorkspace = (await (await request('/workspace')).json()).find((item) => item.id === workspaceId) // 读取摘要最终状态
    const savedSession = JSON.parse(await readFile(join(dataDirectory, 'sessions', `${session.id}.json`), 'utf8')) // 读取磁盘会话
    const savedWorkspaces = JSON.parse(await readFile(join(dataDirectory, 'workspace.json'), 'utf8')) // 读取磁盘工作区
    const savedSummary = savedWorkspaces.find((item) => item.id === workspaceId).sessions.find((item) => item.id === session.id) // 定位磁盘摘要
    expect(savedSession).toEqual(currentSession)         // 磁盘会话不能回退到旧快照
    expect(savedSummary).toEqual(currentWorkspace.sessions.find((item) => item.id === session.id)) // 磁盘摘要不能回退到旧快照
  }, 10000)

  it('deletes a running session without recreating its file', async () => {
    const session = await (await jsonRequest('/session', 'POST', { workspaceId, provider: 'unit', model: 'unit-model' })).json() // 创建待删除会话
    await jsonRequest('/session/send', 'POST', { id: session.id, content: 'RETRY_FOREVER' }) // 让后台进入无限重试
    const removed = await request(`/session?id=${session.id}`, { method: 'DELETE' }) // 删除动作必须先等待后台停止
    expect(removed.status).toBe(200)                    // 运行中会话可以安全删除
    expect(await removed.json()).toEqual({ id: session.id }) // 返回被删除身份
    await Bun.sleep(50)                                 // 给任何迟到 finally 留出写盘机会
    expect(await Bun.file(join(dataDirectory, 'sessions', `${session.id}.json`)).exists()).toBe(false) // 删除后文件不能被后台重建
    expect((await (await request('/workspace')).json())[0].sessions.some((summary) => summary.id === session.id)).toBe(false) // 工作区摘要同步移除
  })

  it('removes a workspace through the query API without deleting its directory', async () => {
    const directory = await mkdtemp(join(dataDirectory, 'workspace-remove-')) // 创建真实可验证目录
    const workspace = await (await jsonRequest('/workspace', 'POST', { path: directory })).json() // 添加工作区记录
    const removed = await request(`/workspace?id=${workspace.id}`, { method: 'DELETE' }) // 使用设计规定 query id
    expect(await removed.json()).toEqual({ id: workspace.id }) // 返回被删除身份
    expect((await stat(directory)).isDirectory()).toBe(true) // 工作区删除不碰本地目录
  })

  it('reloads persisted config, workspaces and sessions after restart', async () => {
    const directory = await mkdtemp(join(dataDirectory, 'restart-workspace-')) // 创建重启验证工作区
    const workspace = await (await jsonRequest('/workspace', 'POST', { path: directory })).json() // 保存工作区记录
    const session = await (await jsonRequest('/session', 'POST', { workspaceId: workspace.id, provider: 'unit', model: 'unit-model' })).json() // 保存会话记录
    const subscription = await subscribe(session.id)    // 建立执行事件监听
    await jsonRequest('/session/send', 'POST', { id: session.id, content: 'FINISH_TOOL' }) // 写入用户、助手和工具消息
    await readUntil(subscription, (event) => event.name === 'status' && event.data.status === 'idle') // 等待所有最终保存结束
    await unsubscribe(subscription)                     // 关闭旧应用 SSE
    await closeApp()                                     // 模拟应用完整退出

    const restarted = await createApp({ dataDirectory }) // 从同一磁盘目录重新创建应用
    app = restarted.app                                  // 后续测试使用重启后的 HTTP 入口
    closeApp = restarted.close                          // afterAll 关闭新应用
    const config = await (await request('/config')).json() // 读取重启恢复配置
    const workspaces = await (await request('/workspace')).json() // 读取重启恢复摘要
    const detail = await (await request(`/session?id=${session.id}`)).json() // 首次按需加载完整会话
    expect(config.provider.key).toBe('unit-secret')     // 配置原值已恢复
    expect(workspaces.find((item) => item.id === workspace.id)?.sessions[0].id).toBe(session.id) // 工作区摘要已恢复
    expect(detail.status).toBe('idle')                  // 已完成会话恢复为空闲
    expect(detail.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool']) // 完整上下文已恢复
    const runtime = await Session.getMutable(session.id) // 读取恢复后的真实运行时字段
    expect(runtime.processes.size).toBe(0)              // 重启后没有遗留子进程
    expect(runtime.abortController).toBeNull()          // 重启后没有遗留停止控制器
    expect(runtime.clients.size).toBe(0)                // 重启后没有遗留 SSE 客户端
    expect(runtime.textOnlyCount).toBe(0)               // 重启后纯文本计数归零
  }, 10000)

  it('contains only the designed production files', async () => {
    const serverRoot = join(import.meta.dir, '..')      // 定位后端根目录
    const expected = {
      commands: ['agent.js', 'config.js', 'session.js', 'tool.js', 'workspace.js'], // 五个业务主体指令
      tools: ['agent.js', 'file.js', 'shell.js', 'web.js'], // 四个平铺工具模块
      utils: ['json.js', 'llm.js', 'retry.js', 'tool.js'], // 保留 LLM、工具、重试和原子 JSON 封装
    }
    for (const [directory, files] of Object.entries(expected)) {
      const actual = (await readdir(join(serverRoot, directory), { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith('.js')) // 只检查生产 JS 文件
        .map((entry) => entry.name)
        .sort()
      expect(actual).toEqual(files)                     // 目录严格匹配最小文件结构
    }
    const rootFiles = (await readdir(serverRoot, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.js')) // 根目录只允许入口和 store
      .map((entry) => entry.name)
      .sort()
    expect(rootFiles).toEqual(['server.js', 'store.js']) // 不保留 Runtime、schemas 或 responses
  })
})
