import { Elysia } from 'elysia' // 接收 HTTP 触发事件并返回反馈。
import Config from './commands/config.js' // 执行配置读写指令。
import Session from './commands/session.js' // 执行会话和 Agent 指令。
import Permission from './features/permission.js' // 启动时加载权限数据。
import Path from './utils/path.js' // 提供配置文件路径。
import SSE from './utils/sse.js' // 提供实时反馈连接。

// 应用对象只负责路由；业务读取、修改和保存都在 commands/features 内完成。
const app = new Elysia()

// --- 转换业务错误 ---
app.onError(({ error, set }) => {
    // 指令抛出错误，入口只把错误转换成稳定的 HTTP 状态和 JSON 反馈。
    set.status = error instanceof TypeError ? 400 : /not found/i.test(error.message) ? 404 : /already running/i.test(error.message) ? 409 : 500
    return { error: error.message }
})

// --- 注册 Agent 触发事件 ---
app.group('/agent', agent => agent
    .post('/send/:sessionId', ({ params, body }) => Session.send({ ...params, ...body }))
    .post('/stop/:sessionId', ({ params }) => Session.stop(params))
    .post('/decide/:sessionId', ({ params, body }) => Session.decide({ ...params, ...body })))

// --- 注册 Session 触发事件 ---
app.group('/session', session => session
    .post('/create', ({ body }) => Session.create(body))
    .get('/read/:sessionId', ({ params }) => Session.read(params))
    .patch('/rename/:sessionId', ({ params, body }) => Session.rename({ ...params, ...body }))
    .delete('/remove/:sessionId', ({ params }) => Session.remove(params))
    .post('/rollback/:sessionId', async ({ params, body }) => {
        return Session.rollback({ ...params, ...body })
    })
    .post('/redo/:sessionId', ({ params }) => Session.redo(params))
    .post('/compact/:sessionId', ({ params, body }) => Session.compact({ ...params, ...body })))

// --- 注册 Config 触发事件 ---
app.group('/config', config => config
    .get('/read', () => Config.read(Path.config()))
    .patch('/set', ({ body }) => Config.set(body)))

// --- 注册 SSE 触发事件 ---
app.group('/sse', sse => sse
    .get('/connect/:sessionId', ({ params, request }) => SSE.connect({ id: params.sessionId, request })))

// --- 启动应用 ---
const start = async ({ port = process.env.PORT || 3000 } = {}) => {
    // 先读取配置，后加载权限；这样 Agent 创建时能拿到完整运行规则。
    await Config.read(Path.config())
    const permission = Config.get().permission
    if (permission) await Permission.load({ path: Path.config() })
    return app.listen(port)
}

export { app, start }

if (import.meta.main) {
    start().then(server => console.log(`Agent server listening on ${server.hostname}:${server.port}`))
}
