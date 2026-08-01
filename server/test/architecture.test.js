/*
 架构契约测试：通过真实 Elysia 请求、磁盘存储和本机模型协议验证正式 Server API。
 本机模型端点只替代外部网络，不跳过 AI SDK、会话持久化或 SSE 事件链。
调用方式：bun test test/architecture.test.js。
*/
import { afterAll, beforeAll, describe, expect, it } from 'bun:test' // 引入 Bun 测试生命周期和断言能力
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises' // 引入隔离数据目录、源码和配置写入能力
import { tmpdir } from 'node:os'                                    // 引入操作系统临时目录位置
import { join } from 'node:path'                                    // 引入跨平台路径拼接能力
import { createApp } from '../server.js'                            // 引入完整 HTTP 应用创建入口

let app                                                              // 保存测试使用的真实 Elysia 应用
let closeApp                                                         // 保存资源统一关闭动作
let modelServer                                                      // 保存本机 OpenAI-compatible 测试端点
let dataDirectory                                                    // 保存测试专属持久化目录


// --- 启动隔离应用和模型端点 ---
beforeAll(async () => {
  modelServer = Bun.serve({                                          // 建立真实 HTTP 模型协议端点
    port: 0,                                                         // 使用系统分配端口避免占用用户服务
    async fetch(request) {
      const body = await request.json()                              // 读取 AI SDK 发送的真实请求结构
      if (!body.stream) return Response.json({ id: 'title', object: 'chat.completion', created: 1, model: 'glm-5.2', choices: [{ index: 0, message: { role: 'assistant', content: '契约测试' }, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } }) // 标题请求返回普通完成结果

      const frames = [                                              // 对话请求返回 OpenAI-compatible 流式帧
        `data: ${JSON.stringify({ id: 'unit', object: 'chat.completion.chunk', created: 1, model: 'glm-5.2', choices: [{ index: 0, delta: { role: 'assistant', content: 'UNIT_OK' }, finish_reason: null }] })}\n\n`, // 输出可验证文本增量
        `data: ${JSON.stringify({ id: 'unit', object: 'chat.completion.chunk', created: 1, model: 'glm-5.2', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 } })}\n\n`, // 输出真实用量和结束原因
        'data: [DONE]\n\n',                                       // 按协议关闭本轮流
      ]
      return new Response(frames.join(''), { headers: { 'content-type': 'text/event-stream' } }) // 通过真实网络响应交给 AI SDK 解析
    },
  })

  dataDirectory = await mkdtemp(join(tmpdir(), 'agent-architecture-')) // 创建与用户数据完全隔离的目录
  const configPath = join(dataDirectory, 'config.json')               // 将测试配置放入隔离数据根
  const config = {
    activeProvider: 'local',                                          // 使用本机测试供应商
    activeModel: 'glm-5.2',                                           // 契约测试保持目标模型名称
    providers: { local: { protocol: 'openai-compatible', apiKey: 'unit-secret', baseURL: `http://127.0.0.1:${modelServer.port}/v1`, models: ['glm-5.2'] } }, // 真实 AI SDK 请求指向本机端点
    systemPrompt: '只输出 UNIT_OK。',                                  // 让无工具轮次保持确定结果
    permissions: {},                                                  // 测试不执行有副作用工具
  }
  await writeFile(configPath, JSON.stringify(config, null, 2))        // 启动前写入真实配置文件
  const created = await createApp({ dataDirectory, configPath, workspaceDirectory: dataDirectory }) // 初始化完整 Runtime
  app = created.app                                                    // 保存请求触发入口
  closeApp = created.close                                             // 保存测试结束清理动作
})


// --- 释放应用和模型端点 ---
afterAll(async () => {
   await closeApp?.()                                                     // 关闭应用资源
  modelServer?.stop(true)                                              // 关闭本机模型协议端点
})


// --- 发送普通 HTTP 请求 ---
function request(path, options = {}) {
  return app.handle(new Request(`http://localhost${path}`, options))   // 所有断言经过真实路由和 schema
}


// --- 发送 JSON HTTP 请求 ---
function jsonRequest(path, method, body) {
  return request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) // 统一序列化业务请求体
}


// --- 等待指定会话产生结束事件 ---
async function waitForFinish(sessionID) {
  const response = await request(`/session/events?sessionId=${sessionID}`) // 建立独立于发送请求的真实 SSE 连接
  const reader = response.body.getReader()                               // 增量读取事件网络字节
  const decoder = new TextDecoder()                                      // 将 UTF-8 字节恢复为 SSE 文本
  let pending = ''                                                       // 保存跨读取批次的不完整帧
  const events = []                                                      // 保存已解析事件供顺序和 ID 断言
  while (true) {
    const { value } = await reader.read()                                 // 等待后台执行的下一批反馈
    pending += decoder.decode(value, { stream: true })                    // 合并本批事件文本
    const frames = pending.split('\n\n')                                // 按标准 SSE 空行切分事件
    pending = frames.pop() ?? ''                                         // 未完成帧留给下一批
    for (const frame of frames) {
      const id = Number(frame.match(/^id: (\d+)$/m)?.[1])                 // 读取单会话递增事件 ID
      const name = frame.match(/^event: (.+)$/m)?.[1]                     // 读取业务事件名称
      const dataText = frame.match(/^data: (.+)$/m)?.[1]                  // 读取 JSON 事件正文
      if (!id || !name || !dataText) continue                             // 忽略心跳或不完整帧
      events.push({ id, name, data: JSON.parse(dataText) })                // 保存可断言事件对象
      if (name === 'finish' || name === 'error') {
        await reader.cancel()                                             // 终态后主动关闭持续订阅
        return events                                                     // 反馈完整执行时间线
      }
    }
  }
}


describe('architecture contract', () => {
  let workspaceID                                                       // 保存默认工作区供会话场景复用
  let sessionID                                                         // 保存正式契约创建的会话身份

  it('reports versioned health and persists workspaces', async () => {
    const health = await (await request('/health')).json()               // 调用无需业务状态的健康入口
    expect(health).toMatchObject({ ok: true, service: 'agent-server', version: '0.1.0', engine: { version: '0.1.0' } }) // 服务身份和版本符合设计

    const workspaces = await (await request('/workspace')).json()        // 读取 Runtime 创建的默认项目
    workspaceID = workspaces[0].id                                       // 保存真实工作区身份
    expect(workspaces[0]).toMatchObject({ id: expect.stringMatching(/^wrk_/), path: dataDirectory, sessions: [] }) // 工作区嵌入下属会话摘要

    const duplicate = await jsonRequest('/workspace', 'POST', { path: dataDirectory }) // 尝试重复添加同一路径
    expect(duplicate.status).toBe(409)                                    // 重复工作区使用真实冲突状态
  })

  it('creates, updates, reads and lists workspace sessions', async () => {
    const created = await jsonRequest('/session', 'POST', { workspaceId: workspaceID, model: 'glm-5.2' }) // 通过正式契约创建工作区会话
    const session = await created.json()                                  // 读取完整持久化会话
    sessionID = session.id                                                 // 保存后续后台执行使用的身份
    expect(session).toMatchObject({ workspaceID, model: 'glm-5.2', status: 'idle', messages: [] }) // 会话包含设计要求核心字段

    const renamed = await jsonRequest('/session', 'PATCH', { sessionId: sessionID, title: '  正式契约  ' }) // 修改会话标题
    expect((await renamed.json()).title).toBe('正式契约')                  // 指令清理首尾空白
    const detail = await (await request(`/session?sessionId=${sessionID}`)).json() // 按正式查询契约读取详情
    expect(detail.lastActiveAt).toBeNumber()                               // 会话公开最近活动时间

    const workspaces = await (await request('/workspace')).json()          // 重新读取主页数据
    expect(workspaces[0].sessions[0]).toMatchObject({ id: sessionID, title: '正式契约', workspaceID }) // 会话摘要归入正确工作区
  })

  it('runs in background and replays ordered SSE events', async () => {
    const sent = await jsonRequest('/session/send', 'POST', { sessionId: sessionID, content: '执行契约测试', model: 'glm-5.2' }) // 发送请求只负责启动后台执行
    expect(sent.status).toBe(200)                                         // 后台执行成功登记
    expect(await sent.json()).toMatchObject({ ok: true, sessionId: sessionID, run: { id: expect.stringMatching(/^run_/), status: 'running' } }) // 立即反馈可查询执行身份

    const events = await waitForFinish(sessionID)                         // 通过独立 SSE 等待真实 AI SDK 流结束
    expect(events.some((event) => event.name === 'text-delta' && JSON.stringify(event.data).includes('UNIT_OK'))).toBe(true) // 模型增量真实经过事件链
    expect(events.at(-1).name).toBe('finish')                              // 正常执行以成功终态结束
    expect(events.map((event) => event.id)).toEqual(events.map((_, index) => index + 1)) // 单会话事件 ID 严格递增

    const replay = await request(`/session/events?sessionId=${sessionID}&afterId=${events.at(-2).id}`) // 从倒数第二个事件恢复
    const replayReader = replay.body.getReader()                            // 保存读取器以便终态后正确释放流锁
    const replayText = new TextDecoder().decode((await replayReader.read()).value) // 读取立即重放的终态事件
    expect(replayText).toContain(`id: ${events.at(-1).id}`)                // 重连只收到尚未确认事件
    await replayReader.cancel()                                            // 关闭持续订阅避免测试挂起

    const detail = await (await request(`/session?sessionId=${sessionID}`)).json() // 读取后台修改后的持久化会话
    expect(detail.status).toBe('idle')                                    // 执行结束后恢复空闲状态
    expect(detail.messages[0].contentBlocks[0]).toEqual({ type: 'text', text: { text: '执行契约测试' } }) // 用户消息使用统一内容块
    expect(detail.messages.some((message) => message.role === 'assistant' && message.contentBlocks.some((block) => block.type === 'text'))).toBe(true) // 助手消息可直接渲染
  }, 15000)

  it('uses real statuses for history, config and deletion conflicts', async () => {
    const invalidHistory = await jsonRequest('/session/history', 'POST', { sessionId: sessionID, action: 'rollback-checkpoint' }) // 缺失存档点调用历史入口
    expect(invalidHistory.status).toBe(400)                               // 参数错误不伪装成 200

    const patched = await jsonRequest('/config', 'PATCH', { systemPrompt: '更新后的提示词' }) // 使用设计规定 PATCH 修改配置
    expect(await patched.json()).toEqual({ ok: true })                     // 配置真实写盘并立即生效
    const config = await (await request('/config')).json()                 // 读取 HTTP 脱敏配置
    expect(config.providers.local.apiKey).toBe('[REDACTED]')               // API 不泄漏上游密钥

    const workspaceConflict = await jsonRequest('/workspace', 'DELETE', { workspaceId: workspaceID }) // 工作区仍被会话引用时尝试移除
    expect(workspaceConflict.status).toBe(409)                              // 防止产生孤立会话
    expect((await jsonRequest('/session', 'DELETE', { sessionId: sessionID })).status).toBe(200) // 先删除会话记录
    expect((await jsonRequest('/workspace', 'DELETE', { workspaceId: workspaceID })).status).toBe(200) // 再移除工作区定义
  })

  it('keeps required server modules and routes free of store access', async () => {
    for (const path of ['routes/health.js', 'commands/history.js', 'commands/skills.js', 'utils/sse.js']) expect(await Bun.file(join(import.meta.dir, '..', path)).exists()).toBe(true) // 设计指定文件必须真实存在
    const routeNames = ['health.js', 'config.js', 'workspace.js', 'session.js'] // 正式设计 Route 只能接收触发并调用 Command
    for (const name of routeNames) expect(await readFile(join(import.meta.dir, '..', 'routes', name), 'utf8')).not.toMatch(/from ['"]\.\.\/store\.js['"]/) // Route 禁止直接读取状态根
  })

  it('allows only architecture-design production modules', async () => {
    const serverRoot = join(import.meta.dir, '..')
    const allowlists = {
      routes: ['config.js', 'health.js', 'session.js', 'workspace.js'],
      commands: ['agent.js', 'approval.js', 'config.js', 'history.js', 'session.js', 'skills.js', 'workspace.js'],
      utils: ['compress.js', 'retry.js', 'sse.js'],
      'tools/built-in': ['agent.js', 'file.js', 'shell.js', 'web.js'],
    }

    for (const [directory, allowed] of Object.entries(allowlists)) {
      const actual = (await readdir(join(serverRoot, directory), { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
        .map((entry) => entry.name)
        .sort()
      const unexpected = actual.filter((name) => !allowed.includes(name))
      expect(unexpected, `${directory} 包含架构设计.txt 未允许的生产 JS 模块，请删除或并入白名单职责模块: ${unexpected.join(', ')}`).toEqual([])
      expect(actual, `${directory} 缺少架构设计.txt 指定模块`).toEqual([...allowed].sort())
    }
  })

  it('validates session queries and exposes canonical config fields', async () => {
    expect((await request('/session')).status).toBe(422)                     // 缺失 sessionId 在 schema 边界拒绝
    expect((await request('/session/events?sessionId=x&afterId=invalid')).status).toBe(422) // 非法事件 ID 不得退化为完整重放
    const config = await (await request('/config')).json()                   // 获取脱敏后的正式配置结构
    expect(config).toMatchObject({ provider: expect.any(Object), tools: expect.any(Object), defaultModel: expect.any(String), systemPrompt: expect.any(String) }) // 设计字段必须公开
  })

})
