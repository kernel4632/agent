/*
最小后端契约测试：通过真实 Elysia 请求、磁盘 JSON、本机模型协议和 SSE 验证 Agent 行为。
本机模型只替代外部网络，配置、会话、工具定义、模型流和停止链仍使用正式实现。
调用方式：bun test test/architecture.test.js。
*/
import { afterAll, beforeAll, describe, expect, it } from 'bun:test' // 引入 Bun 测试生命周期和断言
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises' // 引入隔离目录、结构检查和清理能力
import { tmpdir } from 'node:os'                         // 引入系统临时目录
import { join } from 'node:path'                        // 引入跨平台路径拼接
import { Tool } from '../commands/tool.js'              // 引入并行工具指令供独立验证
import { createApp } from '../server.js'                // 引入完整单文件路由应用
import { store } from '../store.js'                     // 引入严格 store 结构供契约断言
import { retry } from '../utils/retry.js'               // 引入无限重试工具供次数契约验证

let app                                                  // 保存测试使用的 Elysia 应用
let closeApp                                             // 保存应用关闭动作
let dataDirectory                                       // 保存测试专属 .agent 目录
let modelServer                                         // 保存本机 OpenAI-compatible 服务
const modelRequests = []                                // 保存模型收到的真实请求体


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

      const body = await request.json()                  // 读取真实 OpenAI-compatible 请求
      modelRequests.push(body)                           // 保存工具定义和消息供断言
      const prompt = JSON.stringify(body.messages)      // 简单识别测试消息，不参与生产代码
      if (prompt.includes('RETRY_FOREVER')) return Response.json({ error: { message: 'temporary outage' } }, { status: 500 }) // 持续可重试错误
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
  const toolCall = {
    role: 'assistant',                                  // 首个增量声明助手角色
    tool_calls: [{
      index: 0,                                         // 当前响应中的第一个工具调用
      id: 'call_finish',                                // 工具结果匹配使用的稳定 ID
      type: 'function',                                 // OpenAI-compatible 函数工具类型
      function: { name: 'finish', arguments: '{"summary":"DONE"}' }, // 请求 Agent 完成工具
    }],
  }
  const frames = [
    completionFrame(toolCall, null),                    // 输出完整工具调用增量
    completionFrame({}, 'tool_calls'),                  // 以工具调用原因结束模型轮次
    'data: [DONE]\n\n',                               // 关闭流
  ]
  return new Response(frames.join(''), { headers: { 'content-type': 'text/event-stream' } }) // 交给 AI SDK 真实解析
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
    expect(Object.keys(store).sort()).toEqual(['config', 'sessions', 'workspaces']) // store 根节点不能出现额外领域
    expect(Object.keys(store.config).sort()).toEqual(['provider', 'tools']) // config 只包含 provider 和 tools
    expect(Object.keys(store.config.provider).sort()).toEqual(['api', 'key', 'models']) // provider 结构严格匹配设计
    expect(Array.isArray(store.config.tools)).toBe(true) // 工具定义必须是列表
    expect(store.config.tools.length).toBeGreaterThan(0) // 默认内置工具必须可发送给模型
    for (const tool of store.config.tools) expect(Object.keys(tool).sort()).toEqual(['description', 'inputSchema', 'name']) // 每项只保存 LLM 工具信息
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
    expect(config.tools).toEqual(store.config.tools)    // 未修改工具列表保持完整
    const saved = JSON.parse(await readFile(join(dataDirectory, 'config.json'), 'utf8')) // 读取真实配置文件
    expect(saved).toEqual(config)                       // 磁盘结构与 store.config 完全相同

    const invalid = await jsonRequest('/config', 'PATCH', { tools: {} }) // 尝试破坏工具列表形状
    expect(invalid.status).toBe(400)                    // 无效工具配置在 HTTP 边界拒绝
    expect((await (await request('/config')).json()).tools).toEqual(config.tools) // 失败更新不污染 store
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

  it('streams three text-only rounds and sends config.tools to the LLM', async () => {
    const session = await (await jsonRequest('/session', 'POST', { workspaceId, provider: 'unit', model: 'unit-model' })).json() // 创建独立执行会话
    const subscription = await subscribe(session.id)    // 发送前先建立 SSE 防止丢失实时事件
    const requestStart = modelRequests.length           // 记录本测试新增的模型请求边界
    const sent = await jsonRequest('/session/send', 'POST', { id: session.id, content: 'TEXT_ONLY' }) // 后台启动 Agent
    expect(await sent.json()).toEqual({ messageId: expect.any(String) }) // HTTP 立即返回用户消息 ID
    await readUntil(subscription, (event) => event.name === 'status' && event.data.status === 'idle') // 等待三轮结束

    const requests = modelRequests.slice(requestStart)  // 读取本会话三轮模型请求
    expect(requests).toHaveLength(3)                    // 第三次纯文本后才退出
    const sentTools = requests[0].tools.map((tool) => ({ name: tool.function.name, description: tool.function.description, inputSchema: tool.function.parameters })) // 读取协议实际发送的全部工具信息
    expect(sentTools).toEqual(store.config.tools)       // 名称、描述和输入 schema 逐项来自 config.tools
    const detail = await (await request(`/session?id=${session.id}`)).json() // 读取执行后的会话
    expect(detail.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'assistant', 'assistant']) // 保留三轮普通回复
    expect(detail.messages.at(-1).content).toEqual([{ type: 'text', text: { text: 'ROUND_3' } }]) // 内容结构严格匹配 store
    await unsubscribe(subscription)                     // 释放 SSE 客户端
  }, 15000)

  it('executes an LLM tool call and stores the tool result', async () => {
    const session = await (await jsonRequest('/session', 'POST', { workspaceId, provider: 'unit', model: 'unit-model' })).json() // 创建工具执行会话
    const subscription = await subscribe(session.id)    // 发送前建立 SSE
    await jsonRequest('/session/send', 'POST', { id: session.id, content: 'FINISH_TOOL' }) // 请求模型调用 finish
    await readUntil(subscription, (event) => event.name === 'status' && event.data.status === 'idle') // finish 工具结束循环

    expect(subscription.events.some((event) => event.name === 'tool-call' && event.data.toolCall.toolName === 'finish')).toBe(true) // SSE 展示工具调用
    expect(subscription.events.some((event) => event.name === 'tool-result' && event.data.toolResult.output === 'DONE')).toBe(true) // SSE 展示工具结果
    const detail = await (await request(`/session?id=${session.id}`)).json() // 读取持久化上下文
    expect(detail.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool']) // 工具调用和结果形成两条消息
    expect(detail.messages[2].content[0]).toEqual({ type: 'tool_result', toolCallId: 'call_finish', output: 'DONE', isError: false }) // 结果严格符合 store
    await unsubscribe(subscription)                     // 释放 SSE 客户端
  }, 10000)

  it('runs every tool call in the same turn concurrently', async () => {
    const session = await (await jsonRequest('/session', 'POST', { workspaceId, provider: 'unit', model: 'unit-model' })).json() // 创建工具运行上下文
    const startedAt = Date.now()                        // 记录两个固定延迟请求的总耗时
    const result = await Tool.runAll(session.id, [
      { type: 'tool_call', toolCallId: 'web-1', toolName: 'web', input: { url: `http://127.0.0.1:${modelServer.port}/slow` }, status: 'pending' }, // 第一个慢请求
      { type: 'tool_call', toolCallId: 'web-2', toolName: 'web', input: { url: `http://127.0.0.1:${modelServer.port}/slow` }, status: 'pending' }, // 第二个慢请求
    ])
    expect(Date.now() - startedAt).toBeLessThan(350)    // 并行约 200ms，串行约 400ms
    expect(result.results.map((item) => item.output)).toEqual(['SLOW_OK', 'SLOW_OK']) // 结果保持调用顺序
  })

  it('marks a non-zero shell exit as an error result', async () => {
    const session = await (await jsonRequest('/session', 'POST', { workspaceId, provider: 'unit', model: 'unit-model' })).json() // 创建 Shell 工具上下文
    const command = process.platform === 'win32' ? 'exit 7' : 'exit 7' // 两个平台都使用非零退出命令
    const result = await Tool.runAll(session.id, [
      { type: 'tool_call', toolCallId: 'shell-error', toolName: 'shell', input: { command }, status: 'pending' }, // 执行必定失败的命令
    ])
    expect(result.results[0].isError).toBe(true)         // 非零退出码不能伪装成成功工具结果
    expect(result.results[0].output).toContain('exitCode') // 错误仍保留输出和退出码供模型修正
  })

  it('keeps retrying recoverable errors until stop aborts the wait', async () => {
    const session = await (await jsonRequest('/session', 'POST', { workspaceId, provider: 'unit', model: 'unit-model' })).json() // 创建无限重试会话
    const subscription = await subscribe(session.id)    // 建立错误和状态事件监听
    await jsonRequest('/session/send', 'POST', { id: session.id, content: 'RETRY_FOREVER' }) // 触发持续 500 错误
    await readUntil(subscription, (event) => event.name === 'error') // 确认已经进入重试退避
    const stopped = await jsonRequest('/session/stop', 'POST', { id: session.id }) // 在退避期间停止
    expect(await stopped.json()).toEqual({ status: 'idle' }) // stop 立即恢复空闲
    await readUntil(subscription, (event) => event.name === 'status' && event.data.status === 'idle') // SSE 同步反馈停止
    expect((await (await request(`/session?id=${session.id}`)).json()).status).toBe('idle') // 会话最终持久化为空闲
    await unsubscribe(subscription)                     // 释放 SSE 客户端
  }, 10000)

  it('does not impose a retry count limit', async () => {
    let attempts = 0                                    // 记录操作真实执行次数
    const result = await retry(async () => {
      attempts += 1                                     // 每次进入操作都递增
      if (attempts < 6) throw Object.assign(new Error('temporary'), { status: 500 }) // 连续五次可重试失败
      return 'recovered'                                // 第六次成功结束无限循环
    }, null, null, { baseDelay: 0, maxDelay: 0, jitter: 0 }) // 测试不等待真实退避时间
    expect(result).toBe('recovered')                    // 超过旧三次预算后仍可成功
    expect(attempts).toBe(6)                            // 没有隐藏重试次数上限
  })

  it('rejects sends until an error session is explicitly stopped', async () => {
    const session = await (await jsonRequest('/session', 'POST', { workspaceId, provider: 'unit', model: 'unit-model' })).json() // 创建状态控制会话
    const mutable = store.sessions.find((item) => item.id === session.id) // 测试直接模拟不可重试错误结束状态
    mutable.status = 'error'                              // error 不是可直接发送的空闲状态
    const rejected = await jsonRequest('/session/send', 'POST', { id: session.id, content: '不能直接发送' }) // 尝试绕过停止恢复
    expect(rejected.status).toBe(409)                     // 非 idle 会话必须拒绝新 Agent
    expect(await (await jsonRequest('/session/stop', 'POST', { id: session.id })).json()).toEqual({ status: 'idle' }) // 显式停止恢复空闲
  })

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

  it('contains only the designed production files', async () => {
    const serverRoot = join(import.meta.dir, '..')      // 定位后端根目录
    const expected = {
      commands: ['agent.js', 'config.js', 'session.js', 'tool.js', 'workspace.js'], // 五个业务主体指令
      tools: ['agent.js', 'file.js', 'shell.js', 'web.js'], // 四个平铺工具模块
      utils: ['retry.js'],                              // 仅保留无限重试工具
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
