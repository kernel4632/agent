/*
Agent Server 入口：初始化配置、会话、工具数据，并声明 README 规定的全部 HTTP API。
入口只负责接收 HTTP 触发、校验输入、调用 commands 指令和返回结果；业务数据修改留在 commands/store。
调用示例：const { app, close } = await createApp(); app.listen({ hostname: '127.0.0.1', port: 4632 });
*/
import { mkdir } from 'node:fs/promises'                         // 引入创建用户数据目录的能力
import { dirname, join, resolve } from 'node:path'               // 引入跨平台路径定位能力
import { Elysia, t } from 'elysia'                                // 引入 HTTP 路由和请求体校验能力
import { Chat } from './commands/chat.js'                         // 引入对话循环与用户控制指令
import { Config } from './commands/config.js'                     // 引入配置读写指令
import { LSP } from './commands/lsp.js'                           // 引入语言服务器生命周期与状态指令
import { MCP } from './commands/mcp.js'                           // 引入 MCP 连接和工具发现指令
import { Session } from './commands/session.js'                    // 引入会话增删改查指令
import { Skill } from './commands/skill.js'                       // 引入 Agent Skill 扫描与目录指令
import { Tool } from './commands/tool.js'                          // 引入工具加载与查询指令
import { store } from './store.js'                                // 引入服务端唯一状态根

const capabilityStore = store.capabilities                         // 启动流程使用能力领域状态


// --- 创建并初始化 Agent Server ---
export async function createApp(options = {}) {
  const dataDirectory = resolve(options.dataDirectory ?? process.env.AGENT_DATA_DIR ?? join(process.env.USERPROFILE ?? '.', '.agent')) // 从显式参数或用户目录确定真实数据位置
  const sessionsDirectory = join(dataDirectory, 'sessions')       // 会话文件集中放在用户数据目录下
  const toolsDirectory = join(dataDirectory, 'tools')             // 用户自定义工具集中放在用户数据目录下
  const customToolsDirectory = join(toolsDirectory, 'custom')     // 自定义工具目录可由用户或模型写入
  const configPath = resolve(options.configPath ?? join(dataDirectory, 'config.json')) // 配置文件默认位于用户数据根目录
  const builtInToolsDirectory = resolve(options.builtInToolsDirectory ?? join(import.meta.dir, 'tools', 'built-in')) // 内置工具随服务代码分发
  const workspaceDirectory = resolve(options.workspaceDirectory ?? process.env.AGENT_WORKSPACE ?? join(import.meta.dir, '..')) // LSP 与项目 Skill 默认面向工作区根目录
  await mkdir(customToolsDirectory, { recursive: true })           // 确保自定义工具可被扫描和写入
  await mkdir(sessionsDirectory, { recursive: true })              // 确保会话可被加载和持久化
  await Config.load(configPath)                                    // 先加载配置，后续模型和权限读取才有数据
  await Session.load(sessionsDirectory)                            // 从真实文件恢复历史会话
  await Tool.load([builtInToolsDirectory, customToolsDirectory])   // 启动时扫描全部内置与自定义工具
  await Tool.watch()                                                // 集中启动工具热重载副作用
  capabilityStore.workspaceDirectory = workspaceDirectory           // 外部能力使用同一项目根目录
  capabilityStore.dataDirectory = dataDirectory                     // 用户 Skill 从当前 Agent 数据目录发现
  await Skill.reload()                                               // 先注册技能加载工具和元数据目录
  await Promise.all([MCP.reload(), LSP.reload()])                     // 并行连接 MCP 与语言服务器并注册工具

  const app = new Elysia()                                         // 创建可被监听或直接 handle 测试的 Elysia 实例
    .get('/health', () => ({ ok: true }))                           // 提供进程存活检查，不参与业务状态修改
    .post('/chat/send', async ({ body, request }) => {              // 接收用户消息并触发真实 Agent 循环
      let sessionID = body.sessionId                               // 允许客户端继续已有会话
      let initialEvents = []                                       // 新会话需要在模型流之前反馈创建结果
      if (!sessionID) {                                            // 未传会话时自动创建空会话
        const session = await Session.create()                      // 创建完成后再启动流，保证目标会话存在
        sessionID = session.id                                      // 后续循环统一使用真实新会话 ID
        initialEvents = [{ event: 'session-created', data: { id: sessionID } }] // 准备首个 SSE 业务事件
      }
      if (!Session.get(sessionID)) return createJSONError(404, 'session not found') // 已有会话不存在时拒绝写入
      if (Chat.isRunning(sessionID)) return createJSONError(409, 'session is running') // 同一会话不能并发修改消息历史
      let stream                                                        // 保存成功预留运行状态后的 SSE 流
      try { stream = Chat.startLoop({ sessionID, message: body.message, messageID: body.messageId, request, initialEvents }) } // 使用客户端消息 ID 启动或继续会话
      catch (error) { if (error.code === 'SESSION_RUNNING') return createJSONError(409, error.message); throw error } // 处理检查与预留之间的竞争
      return createSSEResponse(stream)                               // 显式声明标准 SSE 响应类型
    }, {
      body: t.Object({
        sessionId: t.Optional(t.String()),                          // 会话 ID 可省略以自动创建
        messageId: t.Optional(t.String()),                          // 前端生成稳定 ID 供当前页面立即回退
        message: t.String({ minLength: 1 }),                         // 空消息没有可执行业务动作
      }),
    })
    .post('/chat/stop', ({ body }) => Chat.stop(body.sessionId), { body: t.Object({ sessionId: t.String() }) }) // 中断指定会话循环
    .post('/chat/approval', async ({ body }) => createCommandResponse(await Chat.approval(body.sessionId, body.toolCallId, body.decision)), { body: t.Object({ sessionId: t.String(), toolCallId: t.String(), decision: t.Union([t.Literal('deny'), t.Literal('allow-once'), t.Literal('always-allow')]) }) }) // 处理拒绝、本次允许或永久允许
    .post('/chat/approve', async ({ body }) => createCommandResponse(await Chat.approve(body.sessionId, body.toolCallId)), { body: t.Object({ sessionId: t.String(), toolCallId: t.String() }) }) // 旧批准入口映射为本次允许
    .post('/chat/reject', async ({ body }) => createCommandResponse(await Chat.reject(body.sessionId, body.toolCallId)), { body: t.Object({ sessionId: t.String(), toolCallId: t.String() }) }) // 旧拒绝入口映射为现场拒绝
    .post('/session/create', () => Session.create())                // 创建新的空会话并返回完整摘要
    .get('/session/list', () => Session.list())                     // 返回所有会话摘要
    .get('/session/:id', ({ params }) => {                          // 读取单个会话完整历史
      const session = Session.get(params.id)                       // 从会话指令读取真实数据副本
      return session ?? createJSONError(404, 'session not found')   // 不存在时返回明确 HTTP 404
    })
    .patch('/session/:id', async ({ params, body }) => createCommandResponse(await Session.rename(params.id, body.title)), { body: t.Object({ title: t.String() }) }) // 验证、持久化用户会话标题
    .get('/session/:id/tasks', ({ params }) => {                       // 读取独立任务清单视图
      const session = Session.get(params.id)                           // 从公开会话副本读取任务状态
      return session ? { tasks: session.tasks, taskRevision: session.taskRevision } : createJSONError(404, 'session not found') // 不存在时反馈资源错误
    })
    .put('/session/:id/tasks', async ({ params, body }) => createCommandResponse(await Session.updateTasks(params.id, body.tasks, body.taskRevision)), { body: t.Object({ tasks: t.Array(t.Any()), taskRevision: t.Optional(t.Number({ minimum: 0 })) }) }) // 完整替换任务并检测可选修订冲突
    .delete('/session/:id', async ({ params }) => Chat.isRunning(params.id) ? createJSONError(409, 'session is running') : createCommandResponse(await Session.remove(params.id), 404)) // 运行中拒绝删除，空闲时删除磁盘记录
    .post('/session/:id/rollback/:step', ({ params }) => Chat.isRunning(params.id) ? { ok: false, error: 'session is running' } : Session.rollback(params.id, Number(params.step))) // 空闲时暂存工具存档点后的历史
    .post('/session/:id/rollback-message', ({ params, body }) => Chat.isRunning(params.id) ? { ok: false, error: 'session is running' } : Session.rollbackMessage(params.id, body.messageId), { body: t.Object({ messageId: t.String() }) }) // 空闲时回退用户消息供编辑重发
    .post('/session/:id/undo-rollback', ({ params }) => Chat.isRunning(params.id) ? { ok: false, error: 'session is running' } : Session.undoRollback(params.id)) // 空闲时恢复最近一次暂存回退
    .get('/tool/list', () => Tool.list())                           // 返回全部已加载工具的公开描述
    .post('/tool/reload', async () => Tool.load([builtInToolsDirectory, customToolsDirectory])) // 重新扫描真实工具目录
    .get('/capability/list', () => ({ tools: Tool.list(), mcp: MCP.list(), lsp: LSP.list(), skills: Skill.list(), skillErrors: capabilityStore.skillErrors })) // 返回外部能力配置与真实运行状态
    .post('/capability/reload', async () => {                            // 配置保存后重建全部外部连接和扫描结果
      const [mcp, lsp, skills] = await Promise.all([MCP.reload(), LSP.reload(), Skill.reload()]) // 三类能力独立重载
      return { ok: true, mcp: mcp.servers, lsp: lsp.servers, skills: skills.skills, skillErrors: skills.errors || [] } // 返回本次真实结果
    })
    .get('/config', () => redactConfig(Config.get()))                // 返回配置但不暴露真实密钥
    .put('/config', ({ body }) => Config.update(body), { body: t.Record(t.String(), t.Any()) }) // 局部更新配置并立即写盘
    .post('/config/test', async ({ body }) => createCommandResponse(await Config.testProvider(body.provider, body.model)), { body: t.Object({ provider: t.String(), model: t.Optional(t.String()) }) }) // 用已保存认证发起最小连通性测试

  return { app, close: async () => { await Promise.all([MCP.close(), LSP.close()]); await Tool.close() } } // 集中关闭外部连接、子进程和文件监听
}


// --- 从首选端口启动本地服务 ---
export function listenOnAvailablePort(app, preferredPort = 4632) {
  for (let port = preferredPort; port <= 65535; port += 1) {          // 从 README 默认端口开始逐个尝试
    try {
      app.listen({ hostname: '127.0.0.1', port, idleTimeout: 255 })   // 长模型轮次允许最多 255 秒无网络数据，避免 SSE 被默认超时切断
      return port                                                      // 反馈宿主实际可连接的端口
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error                    // 非端口占用错误必须立即反馈
    }
  }
  throw new Error('no local port is available')                       // 全部端口占用时给出明确启动错误
}


// --- 创建标准 SSE 响应 ---
function createSSEResponse(stream) {
  return new Response(stream, {                                      // 将对话指令产生的 Web Stream 包装为 HTTP 响应
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',             // 声明浏览器和 TUI 可识别的 SSE 媒体类型
      'cache-control': 'no-cache',                                    // 禁止代理缓存实时模型增量
      connection: 'keep-alive',                                       // 保持长任务连接直到循环结束
    },
  })
}


// --- 创建 JSON 错误响应 ---
function createJSONError(status, message) {
  return Response.json({ error: message }, { status })                // 用稳定 JSON 结构反馈 HTTP 业务错误
}


// --- 将指令结果转换为 HTTP 响应 ---
function createCommandResponse(result, fallbackStatus = 400) {
  if (result.ok) return result                                          // 成功结果保持普通 JSON 响应
  const { status, ...body } = result                                    // 内部状态码不重复出现在 JSON 正文
  return Response.json(body, { status: status ?? fallbackStatus })      // 失败结果使用命令声明或路由默认状态
}


// --- 隐藏配置中的密钥 ---
function redactConfig(config) {
  const safeConfig = structuredClone(config)                       // 复制配置，保证 API 脱敏不修改运行时模型配置
  for (const provider of Object.values(safeConfig.providers ?? {})) { // 遍历每个供应商的认证字段
    if (provider && 'apiKey' in provider) provider.apiKey = provider.apiKey ? '[REDACTED]' : provider.apiKey // 对外只展示存在性
    for (const header of Object.keys(provider?.headers ?? {})) {       // 检查用户配置的全部自定义请求头
      if (/authorization|api[-_]?key|token|cookie|secret/i.test(header) && provider.headers[header]) provider.headers[header] = '[REDACTED]' // 认证类请求头只展示存在性
    }
  }
  for (const server of Object.values(safeConfig.mcpServers ?? {})) {   // MCP 认证和子进程密钥使用同一脱敏规则
    for (const field of ['headers', 'env']) {
      for (const key of Object.keys(server?.[field] ?? {})) {
        if (/authorization|api[-_]?key|token|cookie|secret|password/i.test(key) && server[field][key]) server[field][key] = '[REDACTED]' // 认证字段只展示存在性
      }
    }
  }
  return safeConfig                                                       // 反馈可安全展示给前端的配置副本
}


// --- 直接运行入口 ---
if (import.meta.main) {
  const { app } = await createApp()                                 // 使用用户默认目录初始化真实服务
  const preferredPort = Number(process.env.PORT ?? 4632)            // 默认使用 README 规定的本地端口
  const port = listenOnAvailablePort(app, preferredPort)            // 端口占用时自动递增直到启动成功
  console.log(`Agent Server listening on http://127.0.0.1:${port}`) // 反馈宿主和开发者应连接的实际地址
}
