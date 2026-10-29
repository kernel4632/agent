/*
 * Web 服务入口：接收 HTTP 触发，交给对应的指令，再按状态码把错误发回去。
 *
 * 本文件只做四件事：注册路由、把错误转成 HTTP 反馈、提供服务状态、启动服务。
 * 业务读写都在 commands/ 和 features/ 里完成；根目录不再有第二层业务目录。
 *
 * 调用示例：
 *   await start({ port: 3000 })
 *   await app.handle(new Request('http://localhost/config/read'))   // 测试里直接调用
 */

import { Elysia } from 'elysia'
import Chat from './commands/chat.js'
import Session from './commands/session.js'
import Settings from './commands/settings.js'
import History from './features/history.js'
import SSE from './utils/sse.js'

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
    version: await Settings.version(),
    sessions: Session.count(),
    running: Session.runningCount(),
}))

// --- 工具目录 ---
app.get('/tool/list', () => Settings.listTools())
app.get('/tool/kinds', () => Settings.toolKinds())

// --- 对话：发送、继续、停止、审批 ---
app.group('/agent', agent => agent
    .post('/send/:sessionId', ({ params, body }) => Chat.send({ ...params, ...body }))
    .post('/resume/:sessionId', ({ params }) => Chat.resume(params))
    .post('/stop/:sessionId', ({ params, body }) => Chat.stop({ ...params, ...(body || {}) }))
    .post('/decide/:sessionId', ({ params, body }) => Chat.decide({ ...params, ...body })))

// --- 会话 ---
app.group('/session', session => session
    .get('/list', ({ query }) => Session.list({ search: query.search }))
    .post('/create', ({ body }) => Session.create(body || {}))
    .post('/fork/:sessionId', ({ params, body }) => Session.fork({ ...params, ...(body || {}) }))
    .get('/read/:sessionId', ({ params }) => Session.read(params))
    .get('/changes/:sessionId', ({ params }) => Session.changes(params))
    .get('/settings/:sessionId', ({ params }) => Session.readSettings(params))
    .patch('/settings/:sessionId', ({ params, body }) => Session.saveSettings({ ...params, ...body }))
    .get('/tools/:sessionId', ({ params }) => Session.toolChanges(params))
    .patch('/rename/:sessionId', ({ params, body }) => Session.rename({ ...params, ...body }))
    .post('/title/:sessionId', ({ params }) => Session.generateTitle(params))
    .patch('/model/:sessionId', ({ params, body }) => Session.setModel({ ...params, ...body }))
    .patch('/cwd/:sessionId', ({ params, body }) => Session.setCwd({ ...params, ...body }))
    .delete('/remove/:sessionId', ({ params }) => Session.remove(params))
    .post('/rollback/preview/:sessionId', ({ params, body }) => Session.rollbackPreview({ ...params, ...body }))
    .post('/rollback/tool/:sessionId', ({ params, body }) => Session.rollbackTool({ ...params, ...body }))
    .post('/rollback/:sessionId', ({ params, body }) => Session.rollback({ ...params, ...body }))
    .post('/redo/:sessionId', ({ params, body }) => Session.redo({ ...params, ...(body || {}) }))
    .post('/compact/:sessionId', ({ params }) => Session.compact(params)))

// --- 配置 ---
app.group('/config', config => config
    .get('/read', async () => {
        await Settings.read()
        return Settings.get()
    })
    .get('/meta', () => Settings.meta())
    .patch('/set', ({ body }) => Settings.set(body))
    .post('/test', ({ body }) => Settings.test(body || {})))

// --- SSE ---
app.group('/sse', sse => sse
    .get('/connect/:sessionId', ({ params, request }) => SSE.connect({ id: params.sessionId, request })))

const start = async ({ port = process.env.PORT || 3000 } = {}) => {
    await History.prepare()   // 数据目录先建好，后面所有读写都不用再判断目录在不在。
    await Settings.read()     // 权限规则和模型配置读一次即可。
    return app.listen(port)
}

export { app, start }

if (import.meta.main) {
    const port = process.env.PORT || 3000
    start({ port }).then(() => console.log(`Agent server listening on http://localhost:${port}`))
}
