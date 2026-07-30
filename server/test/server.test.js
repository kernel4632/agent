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
    providers: { aker: { apiKey: provider.options.apiKey, baseURL: provider.options.baseURL, models: ['kimi-k2.6'] } }, // 将真实配置写入测试临时运行配置
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

  it('handles tool list and reload APIs', async () => {
    const listed = await request('/tool/list')                                 // 读取启动时扫描出的真实工具
    const names = (await listed.json()).map((tool) => tool.name)               // 提取工具业务名称
    expect(names).toContain('task_done')                                       // 内置结束工具必须可见

    const reloaded = await jsonRequest('/tool/reload', 'POST')                 // 通过 API 再次扫描真实工具目录
    expect((await reloaded.json()).ok).toBe(true)                              // 验证真实重载完成
  })

  it('handles config get and update APIs', async () => {
    const current = await request('/config')                                   // 读取脱敏后的真实配置
    const currentConfig = await current.json()                                 // 解析配置反馈
    expect(currentConfig.activeModel).toBe('kimi-k2.6')                        // 验证测试模型来自 OpenCode 配置
    expect(currentConfig.providers.aker.apiKey).toBe('[REDACTED]')             // 验证 API 不泄漏真实密钥

    const updated = await jsonRequest('/config', 'PUT', { systemPrompt: realModel.systemPrompt }) // 通过真实 API 写入局部配置
    expect(await updated.json()).toEqual({ ok: true })                         // 验证更新真实落盘

    await jsonRequest('/config', 'PUT', { providers: { aker: { ...currentConfig.providers.aker, models: ['kimi-k2.6', 'another-model'] }, temporary: { apiKey: '', baseURL: 'http://localhost', models: ['local-model'] } } }) // 模拟设置页提交带脱敏密钥的多提供商集合
    expect((await (await request('/config')).json()).providers.aker.models).toContain('another-model') // 验证多模型列表完整替换生效
    expect((await Bun.file(join(dataDirectory, 'config.json')).json()).providers.aker.apiKey).toBe(realModel.providers.aker.apiKey) // 验证脱敏占位符没有覆盖真实密钥

    await jsonRequest('/config', 'PUT', { providers: { aker: { ...currentConfig.providers.aker, models: ['kimi-k2.6'] } } }) // 模拟设置页删除临时提供商
    expect((await (await request('/config')).json()).providers.temporary).toBeUndefined() // 验证完整集合替换真正删除提供商
  })

  it('handles rollback and undo rollback APIs with real session data', async () => {
    const session = (await (await jsonRequest('/session/create', 'POST')).json()) // 创建专门验证回滚的真实会话
    await jsonRequest(`/session/${session.id}/rollback/1`, 'POST')              // 调用不存在存档点，确认错误路径也是真实 API
    const undone = await jsonRequest(`/session/${session.id}/undo-rollback`, 'POST') // 调用撤销回滚 API
    expect((await undone.json()).ok).toBe(false)                                // 没有缓存时必须明确返回失败
  })

  it('handles chat control APIs and real model chat SSE', async () => {
    const unknownStop = await jsonRequest('/chat/stop', 'POST', { sessionId: 'ses_missing' }) // 调用停止 API 的无运行状态分支
    expect((await unknownStop.json()).ok).toBe(false)                            // 没有循环时不能伪造成功
    const unknownApprove = await jsonRequest('/chat/approve', 'POST', { sessionId: 'ses_missing', toolCallId: 'tc_missing' }) // 调用批准 API 的无等待分支
    expect((await unknownApprove.json()).ok).toBe(false)                         // 没有待批准调用时必须失败
    const unknownReject = await jsonRequest('/chat/reject', 'POST', { sessionId: 'ses_missing', toolCallId: 'tc_missing' }) // 调用拒绝 API 的无等待分支
    expect((await unknownReject.json()).ok).toBe(false)                          // 没有待拒绝调用时必须失败

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
