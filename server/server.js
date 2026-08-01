/*
Agent Server 入口：启动运行时资源，并将独立 Elysia 路由插件组合成完整 HTTP 应用。
业务处理、请求模型、响应转换和资源生命周期均由对应模块负责，入口只表达应用结构。
调用示例：const { app, close } = await createApp(); app.listen({ hostname: '127.0.0.1', port: 4632 })。
*/
import { Elysia } from 'elysia'                        // 引入 Elysia 应用和插件组合能力
import { capabilityRoutes } from './routes/capability.js' // 引入外部能力路由插件
import { agentRoutes } from './routes/agent.js'        // 引入 Agent 选择路由插件
import { chatRoutes } from './routes/chat.js'          // 引入对话路由插件
import { configRoutes } from './routes/config.js'      // 引入配置路由插件
import { sessionRoutes } from './routes/session.js'    // 引入会话路由插件
import { toolRoutes } from './routes/tool.js'          // 引入工具路由插件
import { runRoutes } from './routes/run.js'            // 引入 Run 查询和取消路由插件
import { workspaceRoutes } from './routes/workspace.js' // 引入工作区资源路由插件
import { dataRoutes } from './routes/data.js'          // 引入数据备份与清理路由插件
import { Runtime } from './runtime.js'                 // 引入服务端资源生命周期


// --- 创建并初始化 Agent Server ---
export async function createApp(options = {}) {
  const runtime = await Runtime.start(options)         // 路由可用前先恢复状态并连接外部能力
  const app = new Elysia({ name: 'agent.server' })     // 创建可监听或直接 handle 测试的应用
    .decorate('directories', {                         // 将工具目录注入全部后续路由上下文
      builtInTools: runtime.directories.builtInToolsDirectory,
      customTools: runtime.directories.customToolsDirectory,
    })
    .get('/health', () => ({ ok: true, service: 'agent-server', version: '0.1.0', engine: { version: '0.1.0' } })) // 健康检查同时反馈架构要求的引擎版本
    .use(workspaceRoutes)                               // 组合主页工作区资源入口
    .use(dataRoutes)                                    // 组合设置页数据管理入口
    .use(agentRoutes)                                   // 组合 Agent 定义目录入口
    .use(chatRoutes)                                   // 组合消息、停止和审批入口
    .use(sessionRoutes)                                // 组合会话、任务和历史回退入口
    .use(toolRoutes)                                   // 组合工具目录入口
    .use(capabilityRoutes)                             // 组合 MCP、LSP 和 Skills 入口
    .use(configRoutes)                                 // 组合配置读取、保存和测试入口
    .use(runRoutes)                                     // 组合 Run 查询和取消入口

  return { app, close: runtime.close }                 // 宿主统一接收请求入口和资源关闭动作
}


// --- 从首选端口启动本地服务 ---
export function listenOnAvailablePort(app, preferredPort = 4632) {
  for (let port = preferredPort; port <= 65535; port += 1) { // 从默认端口开始逐个尝试
    try {
      app.listen({ hostname: '127.0.0.1', port, idleTimeout: 255 }) // 长模型轮次允许最多 255 秒无网络数据
      return port                                       // 反馈宿主实际监听端口
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error      // 非端口占用错误必须立即暴露
    }
  }
  throw new Error('no local port is available')        // 全部端口占用时停止启动
}


// --- 直接运行入口 ---
if (import.meta.main) {
  const { app } = await createApp()                    // 使用默认用户目录初始化真实服务
  const preferredPort = Number(process.env.PORT ?? 4632) // 允许宿主覆盖 README 默认端口
  const port = listenOnAvailablePort(app, preferredPort) // 端口占用时自动递增
  console.log(`Agent Server listening on http://127.0.0.1:${port}`) // 反馈实际连接地址
}
