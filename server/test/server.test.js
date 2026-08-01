/*
Agent Server 真实 API 测试：所有请求都通过 Elysia.app.handle 进入真实路由、commands、store 和磁盘。
/chat/send 使用 OpenCode 配置中的 aker/kimi-k2.6 真实访问配置，不使用 mock 模型、假响应或虚拟网络层。
调用方式：bun test --timeout 180000。
*/
import { beforeAll, afterAll, describe, expect, it } from 'bun:test' // 引入 Bun 测试生命周期和断言能力
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'          // 引入真实临时目录、Skill 和配置写入能力
import { tmpdir } from 'node:os'                                     // 引入操作系统临时目录位置
import { join } from 'node:path'                                      // 引入跨平台测试路径拼接能力
import { createApp } from '../server.js'                             // 引入可直接处理 Request 的真实应用入口
import { Config } from '../commands/config.js'                       // 引入缓存请求选项供配置行为断言
import { Approval } from '../commands/approval.js'                   // 引入工具审批归属和状态转换断言
import { Session } from '../commands/session.js'                     // 引入两套历史同步回退指令
import { Run } from '../commands/run.js'                              // 引入 Run 父子状态断言
import { store } from '../store.js'                                    // 引入服务端唯一状态根

const toolStore = store.tools                                            // 测试读取动态能力工具注册表
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
    permissions: { task_done: 'allow', load_skill: 'allow' },                     // 模型可先加载测试 Skill，再执行其真实工作流和结束工具
    modelLimits: { 'kimi-k2.6': provider.models['kimi-k2.6'].limit },              // 使用 OpenCode 声明的真实上下文限制
    runTimeoutMs: 270000,                                                          // 真实上游异常时仍保证单个测试 Run 在五分钟内退出
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


// --- 读取真实 SSE 并自动处理一次工具审批 ---
async function readSSEWithApproval(response, initialSessionID = '') {
  const reader = response.body.getReader()                                  // 使用真实 Web Stream 观察增量事件
  const decoder = new TextDecoder()                                         // 将网络字节转换为 SSE 文本
  let buffer = ''                                                           // 保存跨 chunk 的半个事件帧
  let output = ''                                                           // 保留完整流供断言子 Run 反馈
  let sessionID = initialSessionID                                           // 复用已有会话时直接使用调用方提供的归属

  while (true) {
    const next = await reader.read()                                        // 等待模型或工具的下一批真实事件
    if (next.done) break                                                     // 流关闭代表根 Run 已经结束
    const chunk = decoder.decode(next.value, { stream: true })               // 每批字节只解码一次，避免破坏跨 chunk 多字节字符
    buffer += chunk                                                           // 累加可能被网络拆分的 SSE 内容
    output += chunk                                                           // 保留原始事件文本
    const frames = buffer.split('\n\n')                                     // 标准 SSE 事件以空行分隔
    buffer = frames.pop() || ''                                             // 未完成帧留到下一次读取
    for (const frame of frames) {
      const event = frame.match(/^event: ([^\n]+)$/m)?.[1]                  // 读取事件名称
      const dataText = frame.match(/^data: (.+)$/m)?.[1]                     // 读取事件 JSON
      if (!event || !dataText) continue                                      // 忽略注释或不完整帧
      const data = JSON.parse(dataText)                                      // 真实 SSE 数据必须可恢复为对象
      if (event === 'session-created') sessionID = data.id                  // 新会话先反馈身份再允许审批
      if (event === 'tool-approval-request') {
        const approval = await jsonRequest('/chat/approval', 'POST', { sessionId: sessionID, runId: data.runID, toolCallId: data.id, decision: 'allow-once' }) // 用子 Run 归属批准真实工具
        expect((await approval.json()).ok).toBe(true)                        // 审批 API 必须恢复等待中的子 Run
      }
    }
  }
  return output                                                            // 返回完整父流供调用方检查事件顺序
}


describe('Agent Server API', () => {
  let sessionID                                                               // 保存跨 API 测试复用的真实会话 ID

  it('handles health and session creation/list/get APIs', async () => {
    const health = await request('/health')                                    // 调用进程健康 API
    expect(await health.json()).toMatchObject({ ok: true, service: 'agent-server', version: '0.1.0', engine: { version: '0.1.0' } }) // 验证真实路由反馈和版本信息

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

  it('keeps Agent choices and shared-environment child Runs explicit', async () => {
    const agents = await request('/agent/list')                              // 读取当前可选模型 Agent
    expect((await agents.json()).some((agent) => agent.id === 'default')).toBe(true) // 旧配置迁移后必须有默认 Agent

    const session = await Session.create()                                    // 建立只用于 Run 树断言的会话
    const root = Run.create({ sessionID: session.id, agentID: 'default', input: '根任务' }) // 创建根执行
    const child = Run.create({ sessionID: session.id, agentID: 'default', parentRunID: root.id, input: '子任务' }) // 创建共享环境子执行
    expect((await (await request(`/session/${session.id}/runs`)).json()).map((run) => run.id)).toEqual([root.id, child.id]) // API 返回完整父子树

    Run.markRunning(child.id)                                              // 子 Run 开始执行后才能等待工具审批
    const approvalEvents = []                                              // 收集真实审批指令发出的反馈
    const waiting = Approval.wait({ runID: child.id, sessionID: session.id, toolCallID: 'tc_child', toolName: 'task_done', input: { summary: 'OK' }, matched: { rule: null, scope: 'default' }, emit: (event, data) => approvalEvents.push({ event, data }), abortSignal: child.abortController.signal }) // 建立子 Run 的真实审批等待点
    expect(Run.get(child.id).status).toBe('waiting_approval')              // API 和前端可以观察真实等待状态
    expect(approvalEvents[0]).toMatchObject({ event: 'tool-approval-request', data: { runID: child.id, id: 'tc_child' } }) // 反馈必须携带子 Run 归属
    expect((await Approval.decide({ sessionID: 'ses_wrong', runID: child.id, toolCallID: 'tc_child', decision: 'allow-once' })).status).toBe(404) // 错误会话不能恢复其他会话的工具
    expect((await Approval.decide({ sessionID: session.id, toolCallID: 'tc_child', decision: 'allow-once' })).ok).toBe(true) // 兼容入口在唯一匹配时仍能批准
    expect(await waiting).toBe('allow-once')                              // 等待中的工具收到真实决定
    expect(Run.get(child.id).status).toBe('running')                       // 审批不会创建新的隐式执行

    Run.cancel(root.id, 'test cancellation')                               // 父 Run 取消必须向下传播
    expect(Run.get(child.id).status).toBe('cancelled')                     // 子 Run 不能继续悬挂
  })

  it('connects real MCP and LSP processes and progressively loads a real Skill', async () => {
    const fixtureDirectory = join(import.meta.dir, 'fixtures')                     // 定位随测试分发的协议服务脚本
    const skillDirectory = join(dataDirectory, 'skills', 'fixture-skill')          // 使用 Agent 默认用户 Skill 根目录
    const sourcePath = join(dataDirectory, 'fixture.js')                            // 创建 LSP 将读取的真实磁盘文件
    await mkdir(skillDirectory, { recursive: true })                                // 创建规范 Skill 父目录
    await writeFile(join(skillDirectory, 'SKILL.md'), '---\nname: fixture-skill\ndescription: Loads a real test workflow when fixture validation is requested.\nmetadata:\n  version: "1.0"\n---\n\nReturn SKILL_REAL_OK after following this workflow.\n') // 写入有效 YAML frontmatter 和按需正文
    await writeFile(sourcePath, 'BROKEN fixtureSymbol\n')                           // 写入能触发测试诊断的文本

    const updated = await jsonRequest('/config', 'PUT', {
      mcpServers: { fixture: { enabled: true, transport: 'stdio', command: process.execPath, args: [join(fixtureDirectory, 'mcp-server.js')], env: { TEST_SECRET: 'hidden-value' } } }, // 声明真实 MCP 子进程
      lspServers: { fixture: { enabled: true, command: process.execPath, args: [join(fixtureDirectory, 'lsp-server.js')], root: dataDirectory, languageId: 'javascript', extensions: ['js'] } }, // 声明真实 LSP 子进程
      skills: { enabled: true, directories: [], disabled: [] },                    // 启用默认 Skill 扫描
    })
    expect(await updated.json()).toEqual({ ok: true })                              // 配置先真实持久化
    const reloaded = await jsonRequest('/capability/reload', 'POST')                // 通过 HTTP 触发完整关闭、扫描与握手
    expect((await reloaded.json()).ok).toBe(true)                                   // 三类能力均完成重载指令

    const listed = await (await request('/capability/list')).json()                 // 读取运行状态而不是仅看配置
    expect(listed.mcp[0]).toMatchObject({ name: 'fixture', status: 'connected', toolCount: 1 }) // MCP 完成握手与工具发现
    expect(listed.lsp[0]).toMatchObject({ name: 'fixture', status: 'connected' })    // LSP 完成 initialize 生命周期
    expect(listed.skills[0]).toMatchObject({ name: 'fixture-skill', enabled: true }) // Skill 元数据完成发现
    expect(listed.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['mcp_fixture_echo-value', 'lsp_diagnostics', 'load_skill'])) // 三类能力进入统一工具注册表

    const mcpResult = await toolStore.items.get('mcp_fixture_echo-value').execute({ value: 'OK' }) // 通过官方客户端调用真实子进程工具
    expect(mcpResult.structuredContent).toEqual({ echoed: 'OK' })                    // 结构化内容跨协议返回
    expect(mcpResult.content[0].text).toBe('MCP_REAL:OK')                            // 文本内容也跨协议返回
    const diagnosticResult = await toolStore.items.get('lsp_diagnostics').execute({ path: sourcePath }) // 同步文档并等待 publishDiagnostics
    expect(diagnosticResult.diagnostics[0]).toMatchObject({ message: '真实 LSP 诊断', line: 1, character: 1 }) // LSP 坐标转换为公开 1-based
    const definitionResult = await toolStore.items.get('lsp_definition').execute({ path: sourcePath, line: 1, character: 2 }) // 发起真实定义请求
    expect(definitionResult.locations[0]).toMatchObject({ path: sourcePath, line: 1 }) // 定义位置完成 URI 到路径转换
    const skillResult = await toolStore.items.get('load_skill').execute({ name: 'fixture-skill' }) // 通过工具进入第二层披露
    expect(skillResult.instructions).toContain('SKILL_REAL_OK')                    // 完整正文只在激活后返回

    const redacted = await (await request('/config')).json()                       // 检查能力配置安全边界
    expect(redacted.mcpServers.fixture.env.TEST_SECRET).toBe('[REDACTED]')          // API 不泄漏 MCP 子进程密钥
    expect((await Bun.file(join(dataDirectory, 'mcp.json')).json()).mcpServers.fixture.env.TEST_SECRET).toBe('hidden-value') // 独立 MCP 文件保留真实值
    expect((await Bun.file(join(dataDirectory, 'config.json')).json()).mcpServers).toBeUndefined() // 主配置不再重复保存 MCP 定义

    await jsonRequest('/config', 'PUT', { mcpServers: {}, lspServers: {}, skills: { enabled: true, directories: [], disabled: [] } }) // 清空夹具声明
    await jsonRequest('/capability/reload', 'POST')                                // 真实关闭两个子进程，避免影响后续模型测试
  }, 30000)

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

    const temporaryAgent = await (await jsonRequest('/agent', 'POST', { name: '临时 Agent', provider: 'aker', model: 'kimi-k2.6' })).json() // 模拟 Agent 设置页新增定义
    const configWithAgent = await (await request('/config')).json()               // 读取包含新增 Agent 的完整设置草稿
    delete configWithAgent.agents[temporaryAgent.id]                              // 模拟设置页删除一个非默认 Agent
    await jsonRequest('/config', 'PUT', { agents: configWithAgent.agents })        // Agent 集合必须支持完整替换
    expect((await request(`/agent/${temporaryAgent.id}`)).status).toBe(404)        // 被删定义不能被深合并恢复

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

  it('stops retrying when a recoverable provider error exhausts its budget', async () => {
    let calls = 0                                                         // 记录首次调用和后续重试总次数
    const operation = retry(async () => {
      calls += 1                                                          // 每次进入都代表一次真实上游尝试
      const error = new Error('status_code=503, provider unavailable')     // 模拟可恢复但持续存在的服务端错误
      error.statusCode = 503                                              // 使用真实 HTTP 状态进入重试规则
      throw error
    }, () => {}, undefined, { maxRetries: 2, maxElapsedMs: 1000, baseDelayMs: 1, jitterMs: 0 }) // 使用短预算验证确定性终止
    await expect(operation).rejects.toThrow('provider unavailable')        // 最后一次上游错误必须反馈调用方
    expect(calls).toBe(3)                                                  // 首次尝试加两次重试后立即结束
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
    expect(JSON.parse(sessionCreated[1]).id).toMatch(/^ses_/)                    // 真实流创建的会话使用稳定业务 ID
  }, 300000)

  it('runs a real kimi-k2.6 child Agent and approves its tool call through the parent SSE', async () => {
    const worker = await (await jsonRequest('/agent', 'POST', { name: '真实子 Agent', provider: 'aker', model: 'kimi-k2.6', systemPrompt: '你是子 Agent。你必须调用 task_done，summary 必须包含 CHILD_REAL_OK。' })).json() // 创建真实子 Agent 定义
    const orchestrator = await (await jsonRequest('/agent', 'POST', { name: '真实编排 Agent', provider: 'aker', model: 'kimi-k2.6', systemPrompt: `你是根 Agent。你必须调用 spawn_agent，把任务交给 agentId=${worker.id}，prompt 必须要求子 Agent 调用 task_done；不要自己调用 task_done。等待子 Agent 结果后再结束。` })).json() // 创建强制派生子 Agent 的根定义
    await jsonRequest('/config', 'PUT', { permissions: { task_done: 'ask', spawn_agent: 'allow' } }) // 让子 Agent 的结束工具真实进入审批状态
    const session = await (await jsonRequest('/session/create', 'POST', { agentId: orchestrator.id })).json() // 创建使用编排 Agent 的真实会话
    const response = await jsonRequest('/chat/send', 'POST', { sessionId: session.id, agentId: orchestrator.id, message: '请完成一次真实子 Agent 协作测试。' }) // 触发真实 kimi-k2.6 根 Agent
    const streamText = await readSSEWithApproval(response, session.id)            // 观察并批准子 Agent 的真实工具调用
    expect(streamText).toContain('child-run-created')                            // 根流必须公开子 Run 创建事实
    expect(streamText).toContain('tool-approval-request')                        // 子 Run 审批必须冒泡到父 SSE
    expect(streamText).toContain('child-run-finished')                           // 根流必须收到子 Run 完成反馈
    const childCreated = streamText.match(/event: child-run-created\ndata: ({[^\n]+})/) // 从父 SSE 提取真实子 Run 身份
    expect(childCreated).not.toBeNull()                                           // 模型必须真实调用 spawn_agent
    const childRunID = JSON.parse(childCreated[1]).runID                         // 使用协议身份而不是随机模型措辞断言
    const childRun = Run.listForSession(session.id).find((run) => run.id === childRunID) // 从运行状态根读取同一个子执行
    expect(childRun).toMatchObject({ parentRunID: expect.any(String), status: 'completed', agentID: worker.id }) // 子 Agent 必须使用指定 Agent 并完成
    expect(streamText).toMatch(new RegExp(`event: tool-approval-request\\ndata: \\{[^\\n]*"runID":"${childRunID}"`)) // 审批事件必须属于这个子 Run
    await jsonRequest('/config', 'PUT', { permissions: { task_done: 'allow', spawn_agent: 'allow' } }) // 恢复后续真实模型测试的无交互结束工具
  }, 300000)

  it('handles session delete API against real disk storage', async () => {
    const session = (await (await jsonRequest('/session/create', 'POST')).json()) // 创建待删除的真实会话文件
    const deleted = await request(`/session/${session.id}`, { method: 'DELETE' }) // 通过 DELETE API 删除会话
    expect(await deleted.json()).toEqual({ ok: true })                           // 验证内存和磁盘删除成功
    const missing = await request(`/session/${session.id}`)                       // 再次读取已删除会话
    expect(missing.status).toBe(404)                                              // 验证删除效果反馈到 HTTP 层
  })
})
