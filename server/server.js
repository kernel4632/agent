/*
Agent Server 入口：加载持久化数据，注册全部路由。
路由只提取参数并调用 commands/features，不做任何业务逻辑。
调用示例：const { app, close } = await createApp({ dataDirectory }); app.listen(4632)。
*/
import { mkdir } from 'node:fs/promises'                 // 引入目录创建能力
import { join, resolve } from 'node:path'                // 引入路径定位能力
import { Elysia } from 'elysia'                          // 引入 HTTP 服务能力
import { store } from './store.js'                        // 引入全局数据
import { Config } from './commands/config.js'             // 引入配置指令
import { Workspace } from './commands/workspace.js'       // 引入工作区指令
import { Session } from './commands/session.js'           // 引入会话指令
import { Agent } from './commands/agent.js'               // 引入 Agent 指令
import { Title } from './features/title.js'               // 引入标题生成功能
import { Tool } from './utils/tool.js'                    // 引入工具扫描能力
import { SSE } from './utils/sse.js'                      // 引入 SSE 连接能力


// --- 创建应用 ---
export async function createApp(options = {}) {
  const dataDirectory = resolve(options.dataDirectory ?? process.env.AGENT_DATA_DIR ?? join(process.env.USERPROFILE ?? '.', '.agent'))
  await mkdir(join(dataDirectory, 'sessions'), { recursive: true }) // 确保会话目录存在

  store.tools = await Tool.scan(options.toolsDirectory ?? join(import.meta.dir, 'tools')) // 扫描工具
  await Config.load(join(dataDirectory, 'config.json'))   // 加载配置
  await Workspace.load(join(dataDirectory, 'workspace.json')) // 加载工作区
  Session.init(join(dataDirectory, 'sessions'))           // 设定会话目录

  const app = new Elysia({ name: 'agent.server' })
    .get('/health', () => ({ status: 'ok' }))

    .get('/config', () => Config.get())
    .patch('/config', ({ body }) => Config.update(body))

    .get('/workspace', () => Workspace.list())
    .post('/workspace', ({ body }) => Workspace.add(body?.path))
    .delete('/workspace', ({ query }) => Workspace.remove(query.id))

    .get('/session', ({ query }) => Session.get(query.id))
    .post('/session', ({ body }) => Session.create(body?.workspaceId, body?.provider, body?.model))
    .patch('/session', ({ body }) => Session.update(body?.id, body))
    .delete('/session', async ({ query }) => {
      if (store.runtime[query.id]?.status === 'running') await Agent.stop(query.id) // 运行中先停
      return Session.remove(query.id)
    })

    .post('/agent/send', ({ body }) => Agent.send(body?.id, body?.content))
    .post('/agent/stop', ({ body }) => Agent.stop(body?.id))
    .post('/agent/approve', ({ body }) => Agent.approve(body?.id, body?.toolCallId, body?.approved))

    .get('/sse', ({ query }) => {                          // 建立 SSE 连接
      const id = query.id
      if (!store.runtime[id]) store.runtime[id] = { status: 'idle', controller: null, clients: new Set(), tools: new Set(), approvals: new Map() } // 首次连接时初始化运行时
      const runtime = store.runtime[id]
      const { client, response } = SSE.connect((c) => runtime.clients.delete(c))
      runtime.clients.add(client())
      SSE.send(client(), 'sync', { status: runtime.status, messageCount: store.sessions[id]?.messages?.length ?? 0 })
      return response
    })

    .post('/title', ({ body }) => Title.generate(body?.id, body?.prompt))

    .onError(({ code, error, set }) => {
      if (code === 'NOT_FOUND') { set.status = 404; return { error: 'Not Found' } }
      set.status = error.status ?? 500
      return { error: error.message }
    })

  async function close() {
    for (const [id, runtime] of Object.entries(store.runtime)) {
      if (runtime.status === 'running') await Agent.stop(id).catch(() => {})
      for (const client of runtime.clients) try { client.close() } catch {}
      runtime.clients.clear()
    }
  }

  return { app, close, dataDirectory }
}


// --- 直接启动 ---
if (import.meta.main) {
  const { app, close } = await createApp()
  const port = Number(process.env.PORT ?? 4632)
  app.listen({ hostname: '127.0.0.1', port, idleTimeout: 255 })
  console.log(`Agent Server listening on http://127.0.0.1:${port}`)
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => { await close(); app.stop(); process.exit(0) })
  }
}
