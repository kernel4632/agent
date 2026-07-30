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
import { Session } from './commands/session.js'                    // 引入会话增删改查指令
import { Tool } from './commands/tool.js'                          // 引入工具加载与查询指令


// --- 创建并初始化 Agent Server ---
export async function createApp(options = {}) {
  const dataDirectory = resolve(options.dataDirectory ?? process.env.AGENT_DATA_DIR ?? join(process.env.USERPROFILE ?? '.', '.agent')) // 从显式参数或用户目录确定真实数据位置
  const sessionsDirectory = join(dataDirectory, 'sessions')       // 会话文件集中放在用户数据目录下
  const toolsDirectory = join(dataDirectory, 'tools')             // 用户自定义工具集中放在用户数据目录下
  const customToolsDirectory = join(toolsDirectory, 'custom')     // 自定义工具目录可由用户或模型写入
  const configPath = resolve(options.configPath ?? join(dataDirectory, 'config.json')) // 配置文件默认位于用户数据根目录
  const builtInToolsDirectory = resolve(options.builtInToolsDirectory ?? join(import.meta.dir, 'tools', 'built-in')) // 内置工具随服务代码分发
  await mkdir(customToolsDirectory, { recursive: true })           // 确保自定义工具可被扫描和写入
  await mkdir(sessionsDirectory, { recursive: true })              // 确保会话可被加载和持久化
  await Config.load(configPath)                                    // 先加载配置，后续模型和权限读取才有数据
  await Session.load(sessionsDirectory)                            // 从真实文件恢复历史会话
  await Tool.load([builtInToolsDirectory, customToolsDirectory])   // 启动时扫描全部内置与自定义工具
  await Tool.watch()                                                // 集中启动工具热重载副作用

  const app = new Elysia()                                         // 创建可被监听或直接 handle 测试的 Elysia 实例
    .get('/health', () => ({ ok: true }))                           // 提供进程存活检查，不参与业务状态修改
    .post('/chat/send', ({ body, request }) => {                    // 接收用户消息并触发真实 Agent 循环
      let sessionID = body.sessionId                               // 允许客户端继续已有会话
      let isNewSession = false                                     // 记录是否需要向 SSE 反馈会话创建事件
      if (!sessionID) {                                            // 未传会话时自动创建空会话
        return Session.create().then((session) => {                // 创建完成后再启动流，保证目标会话存在
          sessionID = session.id
          isNewSession = true
          const stream = Chat.startLoop({ sessionID, message: body.message, request, initialEvents: isNewSession ? [{ event: 'session-created', data: { id: sessionID } }] : [] }) // 将触发交给对话指令
          return createSSEResponse(stream)                           // 显式声明标准 SSE 响应类型
        })
      }
      if (!Session.get(sessionID)) return createJSONError(404, 'session not found') // 已有会话不存在时拒绝写入
      const stream = Chat.startLoop({ sessionID, message: body.message, request, initialEvents: [] }) // 继续已有会话并返回 SSE
      return createSSEResponse(stream)                               // 显式声明标准 SSE 响应类型
    }, {
      body: t.Object({
        sessionId: t.Optional(t.String()),                          // 会话 ID 可省略以自动创建
        message: t.String({ minLength: 1 }),                         // 空消息没有可执行业务动作
      }),
    })
    .post('/chat/stop', ({ body }) => Chat.stop(body.sessionId), { body: t.Object({ sessionId: t.String() }) }) // 中断指定会话循环
    .post('/chat/approve', ({ body }) => Chat.approve(body.sessionId, body.toolCallId), { body: t.Object({ sessionId: t.String(), toolCallId: t.String() }) }) // 批准所属会话等待中的工具调用
    .post('/chat/reject', ({ body }) => Chat.reject(body.sessionId, body.toolCallId), { body: t.Object({ sessionId: t.String(), toolCallId: t.String() }) }) // 拒绝所属会话等待中的工具调用
    .post('/session/create', () => Session.create())                // 创建新的空会话并返回完整摘要
    .get('/session/list', () => Session.list())                     // 返回所有会话摘要
    .get('/session/:id', ({ params }) => {                          // 读取单个会话完整历史
      const session = Session.get(params.id)                       // 从会话指令读取真实数据副本
      return session ?? createJSONError(404, 'session not found')   // 不存在时返回明确 HTTP 404
    })
    .delete('/session/:id', ({ params }) => Session.remove(params.id)) // 删除会话及其真实磁盘记录
    .post('/session/:id/rollback/:step', ({ params }) => Session.rollback(params.id, Number(params.step))) // 截断指定工具存档点之后的历史
    .post('/session/:id/undo-rollback', ({ params }) => Session.undoRollback(params.id)) // 恢复最近一次回滚缓存
    .get('/tool/list', () => Tool.list())                           // 返回全部已加载工具的公开描述
    .post('/tool/reload', async () => Tool.load([builtInToolsDirectory, customToolsDirectory])) // 重新扫描真实工具目录
    .get('/config', () => redactConfig(Config.get()))                // 返回配置但不暴露真实密钥
    .put('/config', ({ body }) => Config.update(body), { body: t.Record(t.String(), t.Any()) }) // 局部更新配置并立即写盘

  return { app, close: async () => Tool.close() }                   // 将测试和宿主需要的资源清理集中暴露
}


// --- 从首选端口启动本地服务 ---
export function listenOnAvailablePort(app, preferredPort = 4632) {
  for (let port = preferredPort; port <= 65535; port += 1) {          // 从 README 默认端口开始逐个尝试
    try {
      app.listen({ hostname: '127.0.0.1', port })                     // 只监听本机，避免无认证 API 暴露到网络
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


// --- 隐藏配置中的密钥 ---
function redactConfig(config) {
  const safeConfig = structuredClone(config)                       // 复制配置，保证 API 脱敏不修改运行时模型配置
  for (const provider of Object.values(safeConfig.providers ?? {})) { // 遍历每个供应商的认证字段
    if (provider && 'apiKey' in provider) provider.apiKey = provider.apiKey ? '[REDACTED]' : provider.apiKey // 对外只展示存在性
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
