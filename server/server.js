/*
 * Elysia 路由总表
 *
 * server.js 只负责四件事：匹配路由、读取请求参数、调用 commands、返回结果。
 * 业务路由只调用 commands；指令内部负责组合 features、tools 和 utils。
 * SSE 是基础设施例外：连接路由直接调用 utils/sse.js。
 *
 * 路由定位规则：
 *   /agent/...   → commands/agent.js
 *   /session/... → commands/session.js
 *   /config/...  → commands/config.js
 *   /sse/...     → utils/sse.js
 *
 * 路径参数规则：
 *   sessionId 统一放在路由路径中，不放在 body 中。
 *   body 只放当前动作需要提交的数据。
 *
 * ==================== Agent 指令 ====================
 *
 * POST /agent/send/:sessionId
 *   body: { input }
 *   params: { sessionId }
 *   调用: Session.send({ sessionId, input })
 *   结果: { ok: true }
 *   说明: 启动后台 Agent 循环，执行过程通过事件路由推送。
 *
 * POST /agent/stop/:sessionId
 *   params: { sessionId }
 *   调用: Session.stop({ sessionId })
 *   结果: { ok: true }
 *   说明: 停止指定会话正在运行的 Agent 循环。
 *
 * ==================== SSE 基础设施 ====================
 *
 * GET /sse/connect/:sessionId
 *   params: { sessionId }
 *   调用: SSE.connect({ id: sessionId, request })
 *   结果: SSE 事件流
 *   说明: 建立指定会话的持续事件连接。连接、断线、缓存、补发和心跳
 *   都由 utils/sse.js 内部负责，server.js 不参与事件编排。
 *   SSE.send 和 SSE.close 只作为服务端内部调用，不单独暴露 HTTP 路由。
 *
 * ==================== Session 指令 ====================
 *
 * POST /session/create
 *   body: { title }
 *   调用: Session.create({ title })
 *   结果: { sessionId }
 *
 * GET /session/read/:sessionId
 *   params: { sessionId }
 *   调用: Session.read({ sessionId })
 *   结果: { id, title, history }
 *
 * PATCH /session/rename/:sessionId
 *   params: { sessionId }
 *   body: { title }
 *   调用: Session.rename({ sessionId, title })
 *   结果: { id, title }
 *
 * DELETE /session/remove/:sessionId
 *   params: { sessionId }
 *   调用: Session.remove({ sessionId })
 *   结果: { ok: true }
 *
 * POST /session/rollback/:sessionId
 *   params: { sessionId }
 *   body: { messageId }
 *   调用: Session.rollback({ sessionId, messageId })
 *   结果: { sessionId, history }
 *   说明: 指令内部调用 History.rollback 并保存会话状态。
 *
 * POST /session/redo/:sessionId
 *   params: { sessionId }
 *   调用: Session.redo({ sessionId })
 *   结果: { sessionId, history }
 *   说明: 指令内部调用 History.redo 并保存会话状态。
 *
 * POST /session/compact/:sessionId
 *   params: { sessionId }
 *   body: { maxTokens }
 *   调用: Session.compact({ sessionId, maxTokens })
 *   结果: { sessionId, history, token }
 *   说明: 指令内部组合 History、Context 和 Compact。
 *
 * ==================== Config 指令 ====================
 *
 * GET /config/read
 *   调用: Config.read(path)
 *   结果: 当前配置
 *
 * PATCH /config/set
 *   body: newConfig
 *   调用: Config.set(newConfig) → Config.save(path)
 *   结果: 保存后的配置
 */

import { Elysia } from 'elysia'
import Config from './commands/config.js'
import Session from './commands/session.js'
import Permission from './features/permission.js'
import Path from './utils/path.js'
import SSE from './utils/sse.js'

const app = new Elysia()

// 路由只负责把错误转换成 HTTP 响应，业务错误仍由 Command 自己产生。
app.onError(({ error, set }) => {
    set.status = error instanceof TypeError ? 400 : /not found/i.test(error.message) ? 404 : /already running/i.test(error.message) ? 409 : 500
    return { error: error.message }
})

// Agent：启动任务、停止任务、处理工具审批。
app.group('/agent', agent => agent
    .post('/send/:sessionId', ({ params, body }) => Session.send({ ...params, ...body }))
    .post('/stop/:sessionId', ({ params }) => Session.stop(params))
    .post('/decide/:sessionId', ({ params, body }) => Session.decide({ ...params, ...body })))

// Session：管理会话资料和会话历史。
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

// Config：读取和保存全局配置。
app.group('/config', config => config
    .get('/read', () => Config.read(Path.config()))
    .patch('/set', ({ body }) => Config.set(body)))

// SSE：建立事件流连接。
app.group('/sse', sse => sse
    .get('/connect/:sessionId', ({ params, request }) => SSE.connect({ id: params.sessionId, request })))

// 应用启动前先恢复配置和权限规则。
const start = async ({ port = process.env.PORT || 3000 } = {}) => {
    await Config.read(Path.config())
    const permission = Config.get().permission
    if (permission) await Permission.load({ path: Path.config() })
    return app.listen(port)
}

export { app, start }

if (import.meta.main) {
    start().then(server => console.log(`Agent server listening on ${server.hostname}:${server.port}`))
}
