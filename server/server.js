/*
Agent Server 入口：加载最小持久化数据，并在当前文件直接注册全部 Elysia 路由。
路由只提取请求参数和调用 commands；业务数据统一保存在 store。
调用示例：const { app, close } = await createApp({ dataDirectory }); app.listen(4632)。
*/
import { mkdir } from 'node:fs/promises'               // 引入数据目录创建能力
import { join, resolve } from 'node:path'               // 引入数据文件路径定位能力
import { Elysia } from 'elysia'                        // 引入单文件 HTTP 服务能力
import { Agent } from './commands/agent.js'            // 引入发送和停止指令
import { Config } from './commands/config.js'          // 引入配置加载与修改指令
import { Session } from './commands/session.js'        // 引入会话和 SSE 指令
import { load as loadTools } from './commands/tool.js' // 引入启动工具扫描指令
import { Workspace } from './commands/workspace.js'    // 引入工作区指令
import { store } from './store.js'                     // 引入退出清理所需的会话列表


// --- 创建 Agent 应用 ---
export async function createApp(options = {}) {
  const dataDirectory = resolve(options.dataDirectory ?? process.env.AGENT_DATA_DIR ?? join(process.env.USERPROFILE ?? '.', '.agent')) // 确定唯一数据目录
  await mkdir(join(dataDirectory, 'sessions'), { recursive: true }) // 启动前确保会话目录存在
  await loadTools(options.toolsDirectory ?? join(import.meta.dir, 'tools')) // 每次启动重新扫描工具模块
  await Config.load(options.configPath ?? join(dataDirectory, 'config.json')) // 再加载模型供应商配置
  await Workspace.load(options.workspacePath ?? join(dataDirectory, 'workspace.json')) // 再加载工作区摘要
  await Session.load(join(dataDirectory, 'sessions'))   // 最后准备会话按需加载目录

  const app = new Elysia({ name: 'agent.server' })
    .get('/health', () => ({ status: 'ok' }))           // 健康检查直接返回最小状态
    .get('/config', () => Config.get())                 // 返回完整配置和原始 Key
    .patch('/config', ({ body }) => Config.update(body)) // 合并并保存配置
    .get('/workspace', () => Workspace.list())          // 返回工作区与会话摘要
    .post('/workspace', ({ body }) => Workspace.add(body?.path)) // 添加本地工作区
    .delete('/workspace', ({ query }) => Workspace.remove(query.id)) // query id 移除工作区记录
    .get('/session', ({ query }) => Session.get(query.id)) // 返回会话持久化数据
    .post('/session', ({ body }) => Session.create(body?.workspaceId, body?.provider, body?.model)) // 创建完整会话和摘要
    .patch('/session', ({ body }) => Session.update(body?.id, body?.title, body?.provider, body?.model)) // 修改标题、供应商或模型
    .delete('/session', ({ query }) => Session.remove(query.id, Agent.stop)) // 运行中先停止，再删除会话
    .get('/session/events', ({ query }) => Session.listen(query.id)) // 建立会话 SSE 连接
    .post('/session/send', ({ body }) => Agent.send(body?.id, body?.content)) // 保存用户消息并后台启动 Agent
    .post('/session/stop', ({ body }) => Agent.stop(body?.id)) // 停止模型和全部工具进程
    .onError(({ code, error, status }) => {
      if (code === 'NOT_FOUND') return status(404, { error: 'Not Found' }) // 未知路由明确返回 404
      return status(error.status ?? 500, { error: error.message }) // 业务错误保留状态，未知错误返回 500
    })

  async function close() {
    for (const session of [...store.sessions]) {
      if (session.status === 'running' || session.abortController) await Agent.stop(session.id).catch(() => {}) // 关闭前等待模型、工具和最终保存
      Session.closeClients(session)                   // 关闭该会话全部 SSE 连接
    }
  }
  return { app, close, dataDirectory }                // 测试和宿主共享同一个应用入口
}


// --- 直接启动本地服务 ---
if (import.meta.main) {
  const { app, close } = await createApp()            // 使用默认 .agent 数据目录创建应用
  const port = Number(process.env.PORT ?? 4632)       // 默认监听设计指定端口
  app.listen({ hostname: '127.0.0.1', port, idleTimeout: 255 }) // 只允许本机访问并支持长模型请求
  console.log(`Agent Server listening on http://127.0.0.1:${port}`) // 反馈实际地址
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
      await close()                                    // 退出前停止模型、工具进程和 SSE 客户端
      app.stop()                                       // 完成业务清理后停止 HTTP 监听
      process.exit(0)                                  // 明确结束当前服务进程
    })
  }
}
