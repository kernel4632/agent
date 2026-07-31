/*
Agent Server 真实 API 测试：所有请求都通过 Elysia.app.handle 进入真实路由、commands、store 和磁盘。
/chat/send 使用 OpenCode 配置中的 aker/kimi-k2.6 真实访问配置，不使用 mock 模型、假响应或虚拟网络层。
调用方式：bun test --timeout 180000。
*/
import { beforeAll, afterAll, describe, expect, it } from 'bun:test' // 引入 Bun 测试生命周期和断言能力
import { mkdtemp, writeFile } from 'node:fs/promises'                 // 引入真实临时目录和配置写入能力
import { tmpdir } from 'node:os'                                     // 引入操作系统临时目录位置
import { join } from 'node:path'                                      // 引入跨平台测试路径拼接能力
import { createApp } from '../server.js'                             // 引入可直接处理 Request 的真实应用入口
import { Config } from '../commands/config.js'                       // 引入缓存请求选项供配置行为断言
import { Session } from '../commands/session.js'                     // 引入两套历史同步回退指令
import { retry } from '../utils/retry.js'                             // 引入中断不重试行为验证

let app                                                                  // 保存测试使用的真实 Elysia 应用
let closeApp                                                             // 保存监听器清理动作
let dataDirectory                                                        // 保存测试专属磁盘目录
let realModel                                                            // 保存从 OpenCode 配置读取出的真实模型配置


// --- 从 OpenCode 配置准备真实模型 ---
beforeAll(async () => {
  const openCodeConfig = await Bun.file(join(process.env.USERPROFILE, '.config', 'opencode', 'opencode.json')).json() // 读取用户真实 OpenCode 配置
  const provider = openCodeConfig.provider.aker                                  // 选择配置中声明 kimi-k2.6 的 aker 供应商
  realModel = {                                                                   // 只提取测试需要的真实认证与模型字段
    activeProvider: 'aker',                                                       // 使用 OpenCode 中目标供应商
    activeModel: 'kimi-k2.6',                                                     // 严格使用用户指定的模型名称
    providers: { aker: { apiKey: provider.options.apiKey, baseURL: provider.options.baseURL, models: ['kimi-k2.6'], setCacheKey: true } }, // 将真实认证、模型和缓存行为写入测试配置
    systemPrompt: '你是测试中的 Agent。收到请求后必须调用 task_done，并在 summary 中写出 REAL_MODEL_OK。', // 让真实模型产生可验证工具调用
    permissions: { task_done: 'allow' },                                          // 测试任务结束工具允许真实执行
    modelLimits: { 'kimi-k2.6': provider.models['kimi-k2.6'].limit },              // 使用 OpenCode 声明的真实上下文限制
  }
  dataDirectory = await mkdtemp(join(tmpdir(), 'agent-server-real-'))             // 建立只属于本次测试的真实磁盘数据目录
  const configPath = join(dataDirectory, 'config.json')                            // 测试配置与生产用户配置隔离
  await writeFile(configPath, JSON.stringify(realModel, null, 2))                  // 写入由 OpenCode 配置派生的真实调用配置
  const created = await createApp({ dataDirectory, configPath })                   // 初始化真实 server、工具和文件存储
  app = created.app                                                                  // 保存请求入口
  closeApp = created.close                                                            // 保存资源清理入口
})


afterAll(async () => {
  await closeApp?.()                                                               // 关闭 chokidar，避免测试进程被监听器挂住
})


async function request(path, options = {}) {
  return app.handle(new Request(`http://localhost${path}`, options))               // 每个测试都走完整 HTTP 解析和路由链路
}


async function jsonRequest(path, method, body) {
  return request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) // 统一构造 JSON HTTP 请求
}


describe('Agent Server API', () => {
  let sessionID                                                               // 保存跨 API 测试复用的真实会话 ID

  it('handles health and session creation/list/get APIs', async () => {
    const health = await request('/health')                                    // 调用进程健康 API
    expect(await health.json()).toEqual({ ok: true })                          // 验证真实路由反馈

    const created = await jsonRequest('/session/create', 'POST')               // 通过真实 API 创建磁盘会话
    const session = await created.json()                                       // 读取服务返回的会话数据
    sessionID = session.id                                                      // 保存后续 API 要用的真实 ID
    expect(sessionID).toMatch(/^ses_/)                                         // 验证项目规定的 ID 格式

    const listed = await request('/session/list')                              // 读取真实会话摘要列表
    expect((await listed.json()).some((item) => item.id === sessionID)).toBe(true) // 验证创建结果进入列表

    const detail = await request(`/session/${sessionID}`)                      // 读取完整会话历史
    expect((await detail.json()).messages).toEqual([])                         // 新会话历史应为空
  })

  it('persists validated session titles and revisioned task lists', async () => {
    const session = await (await jsonRequest('/session/create', 'POST')).json() // 创建独立会话验证元数据写入
    const renamed = await jsonRequest(`/session/${session.id}`, 'PATCH', { title: '  手动标题  ' }) // 提交包含首尾空白的用户标题
    expect(await renamed.json()).toEqual({ ok: true, title: '手动标题', titleSource: 'user' }) // API 返回清理后的用户标题来源
    expect(Session.get(session.id).titleSource).toBe('user')                    // 运行时持久化结构阻止异步标题覆盖

    const emptyTitle = await jsonRequest(`/session/${session.id}`, 'PATCH', { title: '   ' }) // 尝试写入空标题
    expect(emptyTitle.status).toBe(400)                                         // 标题验证错误使用真实 HTTP 状态
    const longTitle = await jsonRequest(`/session/${session.id}`, 'PATCH', { title: 'x'.repeat(101) }) // 尝试超过持久化上限
    expect(longTitle.status).toBe(400)                                          // 超长标题保持原值

    const tasks = [{ content: '实现后端任务清单', status: 'in_progress', priority: 'high' }] // 构造工作台任务结构
    const updated = await jsonRequest(`/session/${session.id}/tasks`, 'PUT', { tasks, taskRevision: 0 }) // 按初始修订替换完整清单
    expect(await updated.json()).toEqual({ ok: true, tasks, taskRevision: 1 })   // 成功更新递增任务修订
    const listed = await request(`/session/${session.id}/tasks`)                 // 从独立任务 API 重新读取
    expect(await listed.json()).toEqual({ tasks, taskRevision: 1 })              // 读取结果来自持久化会话状态

    const conflict = await jsonRequest(`/session/${session.id}/tasks`, 'PUT', { tasks: [], taskRevision: 0 }) // 用旧修订覆盖新清单
    expect(conflict.status).toBe(409)                                            // 并发覆盖反馈真实冲突状态
    const invalid = await jsonRequest(`/session/${session.id}/tasks`, 'PUT', { tasks: [{ content: '错误状态', status: 'done', priority: 'high' }] }) // 提交非法状态
    expect(invalid.status).toBe(400)                                             // 非法任务不修改持久化清单
    expect(Session.get(session.id).tasks).toEqual(tasks)                         // 冲突和验证失败后原任务保持不变
  })

  it('handles tool list and reload APIs', async () => {
    const listed = await request('/tool/list')                                 // 读取启动时扫描出的真实工具
    const names = (await listed.json()).map((tool) => tool.name)               // 提取工具业务名称
    expect(names).toContain('task_done')                                       // 内置结束工具必须可见
    expect(names).toContain('task_list_update')                                // 内置持久化任务工具必须可见

    const reloaded = await jsonRequest('/tool/reload', 'POST')                 // 通过 API 再次扫描真实工具目录
    expect((await reloaded.json()).ok).toBe(true)                              // 验证真实重载完成
  })

  it('handles config get and update APIs', async () => {
    const current = await request('/config')                                   // 读取脱敏后的真实配置
    const currentConfig = await current.json()                                 // 解析配置反馈
    expect(currentConfig.activeModel).toBe('kimi-k2.6')                        // 验证测试模型来自 OpenCode 配置
    expect(currentConfig.providers.aker.apiKey).toBe('[REDACTED]')             // 验证 API 不泄漏真实密钥
    expect(currentConfig.providers.aker).toMatchObject({ protocol: 'openai-compatible', headers: {}, timeoutMs: 120000, cache: { enabled: true, mode: 'implicit' }, modelSettings: {} }) // 旧供应商记录已迁移为显式结构
    expect(Config.getProviderOptions('ses_cache')).toBeUndefined()                    // Kimi 中转不注入无效缓存字段

    const updated = await jsonRequest('/config', 'PUT', { systemPrompt: realModel.systemPrompt }) // 通过真实 API 写入局部配置
    expect(await updated.json()).toEqual({ ok: true })                         // 验证更新真实落盘
    const missingProvider = await jsonRequest('/config/test', 'POST', { provider: 'missing-provider' }) // 测试不存在的已保存供应商
    expect(missingProvider.status).toBe(404)                                   // 连通性测试不接受请求携带的临时认证

    await jsonRequest('/config', 'PUT', { providers: { aker: { ...currentConfig.providers.aker, headers: { Authorization: 'Bearer saved-secret', 'X-Trace': 'visible' }, modelSettings: { 'kimi-k2.6': { context: 64000, maxOutputTokens: 2048, temperature: 0.2 } } } } }) // 写入自定义请求头和模型设置
    const configured = await (await request('/config')).json()                  // 读取脱敏后的显式供应商配置
    expect(configured.providers.aker.headers).toEqual({ Authorization: '[REDACTED]', 'X-Trace': 'visible' }) // 只隐藏敏感请求头
    expect(Config.getGenerationOptions()).toEqual({ maxOutputTokens: 2048, temperature: 0.2 }) // 生成设置可直接传给 AI SDK
    expect(Config.getContextLimit()).toBe(64000)                                 // 新上下文设置优先于旧 modelLimits
    expect((await Bun.file(join(dataDirectory, 'config.json')).json()).providers.aker.headers.Authorization).toBe('Bearer saved-secret') // 磁盘保留真实请求头而非脱敏占位符

    await jsonRequest('/config', 'PUT', { providers: { aker: { ...currentConfig.providers.aker, models: ['kimi-k2.6', 'another-model'] }, temporary: { apiKey: '', baseURL: 'http://localhost', models: ['local-model'] } } }) // 模拟设置页提交带脱敏密钥的多提供商集合
    expect((await (await request('/config')).json()).providers.aker.models).toContain('another-model') // 验证多模型列表完整替换生效
    expect((await Bun.file(join(dataDirectory, 'config.json')).json()).providers.aker.apiKey).toBe(realModel.providers.aker.apiKey) // 验证脱敏占位符没有覆盖真实密钥

    await jsonRequest('/config', 'PUT', { providers: { aker: { ...currentConfig.providers.aker, models: ['kimi-k2.6'] } } }) // 模拟设置页删除临时提供商
    expect((await (await request('/config')).json()).providers.temporary).toBeUndefined() // 验证完整集合替换真正删除提供商

    await jsonRequest('/config', 'PUT', { activeProvider: 'test-openai', activeModel: 'gpt-test', providers: { aker: currentConfig.providers.aker, 'test-openai': { apiKey: '', baseURL: 'http://localhost', models: ['gpt-test'], setCacheKey: true } } }) // 临时切换到 Responses 协议验证无状态续轮参数
    expect(Config.getProviderOptions('ses_cache')).toEqual({ openai: { store: false, promptCacheKey: 'ses_cache', promptCacheOptions: { mode: 'implicit' } } }) // 中转不保存 rs_ item 时必须携带完整加密 reasoning
    await jsonRequest('/config', 'PUT', { activeProvider: 'aker', activeModel: 'kimi-k2.6', providers: { aker: currentConfig.providers.aker } }) // 恢复后续真实 Kimi 测试配置
  })

  it('handles rollback and undo rollback APIs with real session data', async () => {
    const session = (await (await jsonRequest('/session/create', 'POST')).json()) // 创建专门验证回滚的真实会话
    await jsonRequest(`/session/${session.id}/rollback/1`, 'POST')              // 调用不存在存档点，确认错误路径也是真实 API
    const undone = await jsonRequest(`/session/${session.id}/undo-rollback`, 'POST') // 调用撤销回滚 API
    expect((await undone.json()).ok).toBe(false)                                // 没有缓存时必须明确返回失败
  })

  it('does not report a retry after an intentional abort', async () => {
    const stopSignal = new AbortController()                             // 创建与 Chat.stop 相同的中断信号
    let retryCount = 0                                                   // 记录错误重试反馈次数
    const operation = retry(async () => {                                // 启动会等待中断的模型替身
      stopSignal.abort()                                                 // 模拟用户在模型请求期间主动停止
      throw new DOMException('aborted', 'AbortError')                    // 模拟提供商抛出的标准中断错误
    }, () => { retryCount += 1 }, stopSignal.signal)
    await expect(operation).rejects.toMatchObject({ name: 'AbortError' }) // 中断应直接退出重试工具
    expect(retryCount).toBe(0)                                           // 前端不应收到 error-retry 事件
  })

  it('does not retry a non-recoverable provider error', async () => {
    let retryCount = 0                                                   // 记录配置错误是否错误进入退避
    const operation = retry(async () => {                                // 模拟 AI SDK 返回认证失败
      const error = new Error('status_code=401, invalid API key')         // 保留真实中转常见错误格式
      error.statusCode = 401                                              // 同时覆盖结构化状态字段
      throw error
    }, () => { retryCount += 1 })
    await expect(operation).rejects.toThrow('invalid API key')            // 不可恢复错误立即交回调用方
    expect(retryCount).toBe(0)                                            // 前端不显示无意义重试倒计时
  })

  it('stages a user message rollback across display and model history', async () => {
    const created = await Session.create()                                      // 创建独立会话验证内部两套历史
    const session = Session.getMutable(created.id)                              // 读取 commands 可修改真实对象
    session.messages = [                                                        // 构造两轮用户可见历史
      { id: 'msg_first', role: 'user', content: '第一句' },
      { id: 'msg_answer', role: 'assistant', content: '第一答复' },
      { id: 'msg_second', role: 'user', content: '第二句' },
      { id: 'msg_final', role: 'assistant', content: '第二答复' },
    ]
    session.modelMessages = [                                                   // 构造与展示历史对应的模型协议历史
      { role: 'user', content: '第一句' },
      { role: 'assistant', content: '第一答复' },
      { role: 'user', content: '第二句' },
      { role: 'assistant', content: '第二答复' },
    ]
    await Session.persist(session)                                               // 保存回退前完整基线

    const rolledBack = await jsonRequest(`/session/${created.id}/rollback-message`, 'POST', { messageId: 'msg_second' }) // 暂存第二轮
    expect(await rolledBack.json()).toMatchObject({ ok: true, content: '第二句' }) // API 反馈输入框原文
    expect(Session.getMutable(created.id).messages.map((item) => item.id)).toEqual(['msg_first', 'msg_answer']) // 展示历史隐藏第二轮
    expect(Session.getMutable(created.id).modelMessages).toHaveLength(2)         // 模型上下文同步隐藏第二轮
    expect(Session.get(created.id).rollback).toMatchObject({ count: 2, target: { messageID: 'msg_second' } }) // 前端获得撤销摘要

    const restored = await jsonRequest(`/session/${created.id}/undo-rollback`, 'POST') // 撤销暂存边界
    expect(await restored.json()).toEqual({ ok: true, restoredMessages: 2 })      // 反馈真实恢复数量
    expect(Session.getMutable(created.id).messages).toHaveLength(4)              // 展示历史完整恢复
    expect(Session.getMutable(created.id).modelMessages).toHaveLength(4)         // 模型上下文完整恢复
  })

  it('handles chat control APIs and real model chat SSE', async () => {
    const unknownStop = await jsonRequest('/chat/stop', 'POST', { sessionId: 'ses_missing' }) // 调用停止 API 的无运行状态分支
    expect((await unknownStop.json()).ok).toBe(false)                            // 没有循环时不能伪造成功
    const unknownApprove = await jsonRequest('/chat/approve', 'POST', { sessionId: 'ses_missing', toolCallId: 'tc_missing' }) // 调用批准 API 的无等待分支
    expect((await unknownApprove.json()).ok).toBe(false)                         // 没有待批准调用时必须失败
    const unknownReject = await jsonRequest('/chat/reject', 'POST', { sessionId: 'ses_missing', toolCallId: 'tc_missing' }) // 调用拒绝 API 的无等待分支
    expect((await unknownReject.json()).ok).toBe(false)                          // 没有待拒绝调用时必须失败
    const unknownApproval = await jsonRequest('/chat/approval', 'POST', { sessionId: 'ses_missing', toolCallId: 'tc_missing', decision: 'always-allow' }) // 调用三选一审批的无等待分支
    expect(unknownApproval.status).toBe(404)                                     // 新审批入口使用真实未找到状态

    const streamResponse = await jsonRequest('/chat/send', 'POST', { message: '请完成真实模型连通性测试。' }) // 触发真实 kimi-k2.6 Agent 调用
    expect(streamResponse.headers.get('content-type')).toContain('text/event-stream') // 验证 API 返回真实 SSE
    const streamText = await streamResponse.text()                               // 等待真实模型和工具执行完整结束
    expect(streamText).toContain('tool-call')                                   // 验证模型真实产生工具调用事件
    expect(streamText).toContain('REAL_MODEL_OK')                                // 验证模型真实返回测试标记
    const sessionCreated = streamText.match(/event: session-created\ndata: ({[^\n]+})/) // 从真实 SSE 读取自动创建的会话事件
    expect(sessionCreated).not.toBeNull()                                        // 自动创建会话必须先反馈给客户端
    const realSessionID = JSON.parse(sessionCreated[1]).id                       // 提取真实模型会话 ID 供后续 API 使用

    const continuedResponse = await jsonRequest('/chat/send', 'POST', { sessionId: realSessionID, message: '再次完成真实模型测试。' }) // 在同一历史上再跑一次真实模型
    expect(await continuedResponse.text()).toContain('REAL_MODEL_OK')            // 验证已有会话也走真实 kimi-k2.6
    const rolledBack = await jsonRequest(`/session/${realSessionID}/rollback/1`, 'POST') // 回滚真实工具产生的第一个 checkpoint
    expect((await rolledBack.json()).ok).toBe(true)                               // 验证成功截断第二轮真实消息
    const restored = await jsonRequest(`/session/${realSessionID}/undo-rollback`, 'POST') // 撤销刚才的真实回滚
    expect((await restored.json()).restoredMessages).toBeGreaterThan(0)           // 验证被截断消息真实恢复
  }, 180000)

  it('handles session delete API against real disk storage', async () => {
    const session = (await (await jsonRequest('/session/create', 'POST')).json()) // 创建待删除的真实会话文件
    const deleted = await request(`/session/${session.id}`, { method: 'DELETE' }) // 通过 DELETE API 删除会话
    expect(await deleted.json()).toEqual({ ok: true })                           // 验证内存和磁盘删除成功
    const missing = await request(`/session/${session.id}`)                       // 再次读取已删除会话
    expect(missing.status).toBe(404)                                              // 验证删除效果反馈到 HTTP 层
  })
})
