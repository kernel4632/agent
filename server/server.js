/*
 * Web 服务入口：接收 HTTP 触发，交给对应的指令，再按状态码把错误发回去。
 *
 * 本文件只做四件事：注册路由、把错误转成 HTTP 反馈、提供服务状态和工作区信息、启动服务。
 * 业务读取、修改和保存都在 commands/ 与 features/ 内完成。
 * 调用示例：
 *   await start({ port: 3000 })          // 启动服务
 *   await app.handle(new Request('http://localhost/config/read'))  // 测试里直接调用
 */

import { Elysia } from 'elysia' // 接收 HTTP 触发事件并返回反馈。
import Config from './commands/config.js' // 执行配置读写指令。
import Session from './commands/session.js' // 执行会话和 Agent 指令。
import Ignore from './features/ignore.js' // 启动时读一次忽略规则。
import Workspace from './features/workspace.js' // 读工作区信息和 git 状态。
import Path from './utils/path.js' // 提供配置文件路径。
import SSE from './utils/sse.js' // 提供实时反馈连接。

const app = new Elysia()

// --- 转换业务错误 ---
app.onError(({ error, set }) => {
    // 指令抛出的错误自带状态码；没有状态码的说明是程序问题，按 500 返回并带上原因。
    set.status = error.status || 500
    return { error: error.message }
})

// --- 服务状态 ---
app.get('/health', async () => ({
    ok: true,
    version: await Config.version(), // 前端在启动时就能确认自己连的是哪个版本的后端。
    sessions: Session.count(), // 有多少条会话正在内存里被使用。
    running: Session.runningCount(), // 有多少条会话正在跑任务。
}))

// --- 工作区信息 ---
app.group('/workspace', workspace => workspace
    .get('/read', () => Workspace.read())
    .get('/status', ({ query }) => Workspace.status({ path: query.path })))

// --- 注册 Agent 触发事件 ---
app.group('/agent', agent => agent
    .post('/send/:sessionId', ({ params, body }) => Session.send({ ...params, ...body }))
    .post('/stop/:sessionId', ({ params }) => Session.stop(params))
    .post('/decide/:sessionId', ({ params, body }) => Session.decide({ ...params, ...body })))

// --- 注册 Session 触发事件 ---
app.group('/session', session => session
    .get('/list', ({ query }) => Session.list({ search: query.search }))
    .post('/create', ({ body }) => Session.create(body))
    .get('/read/:sessionId', ({ params }) => Session.read(params))
    .get('/changes/:sessionId', ({ params }) => Session.changes(params))
    .patch('/rename/:sessionId', ({ params, body }) => Session.rename({ ...params, ...body }))
    .delete('/remove/:sessionId', ({ params }) => Session.remove(params))
    .post('/rollback/:sessionId', ({ params, body }) => Session.rollback({ ...params, ...body }))
    .post('/redo/:sessionId', ({ params }) => Session.redo(params))
    .post('/compact/:sessionId', ({ params }) => Session.compact({ ...params, ...body })))

// --- 注册 Config 触发事件 ---
app.group('/config', config => config
    .get('/read', () => Config.read(Path.config()))
    .patch('/set', ({ body }) => Config.set(body))
    .post('/test', ({ body }) => Config.test(body || {}))) // 设置页的"测试连接"按钮走这里。

// --- 注册 SSE 触发事件 ---
app.group('/sse', sse => sse
    .get('/connect/:sessionId', ({ params, request }) => SSE.connect({ id: params.sessionId, request })))

const start = async ({ port = process.env.PORT || 3000 } = {}) => {
    await Session.prepare() // 数据目录先建好，后面所有读写都不用再判断目录在不在。
    // 权限规则就写在配置的 permission 字段里，读一次配置即可拿到完整运行规则。
    await Config.read(Path.config())
    await Ignore.load() // 忽略规则启动时读一次，之后每次工具调用直接用编译好的规则。
    return app.listen(port)
}

export { app, start }

if (import.meta.main) {
    // 监听成功后打印真实地址，方便用户和日志确认服务开在哪个端口。
    const port = process.env.PORT || 3000
    start({ port }).then(() => console.log(`Agent server listening on http://localhost:${port}`))
}
