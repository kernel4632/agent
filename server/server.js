/*
Agent Server 入口：设定路径、加载持久化数据、注册路由。
每条路由只做参数提取和方法调用，不包含任何业务逻辑。
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


// --- 创建应用 ---
export async function createApp(options = {}) {
  const dataDirectory = resolve(options.dataDirectory ?? process.env.AGENT_DATA_DIR ?? join(process.env.USERPROFILE ?? '.', '.agent'))
  store.paths.sessions = join(dataDirectory, 'sessions')
  store.paths.config = join(dataDirectory, 'config.json')
  store.paths.workspace = join(dataDirectory, 'workspace.json')
  await mkdir(store.paths.sessions, { recursive: true }) // 确保会话目录存在

  store.tools = await Tool.scan(options.toolsDirectory ?? join(import.meta.dir, 'tools'))
  await Config.load()
  await Workspace.load()

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
    .delete('/session', ({ query }) => Session.remove(query.id))
    .post('/agent/send', ({ body }) => Agent.send(body?.id, body?.content))
    .post('/agent/stop', ({ body }) => Agent.stop(body?.id))
    .post('/agent/approve', ({ body }) => Agent.approve(body?.id, body?.toolCallId, body?.approved))
    .get('/sse', ({ query }) => Agent.connect(query.id))
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
