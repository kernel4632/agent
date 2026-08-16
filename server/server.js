/* HTTP 入口只负责 schema、鉴权和转发。 */
import { Elysia, t } from 'elysia' // 提供 HTTP 服务和请求 schema 校验。
import { createUIMessageStreamResponse } from 'ai' // 把内部事件流编码为 AI SDK SSE。
import Store from './store.js' // 启动时加载并在关闭前保存业务数据。
import Auth from './commands/auth.js' // 处理登录 cookie 和私有路由鉴权。
import Config from './commands/config.js' // 转发配置读写请求。
import Workspace from './commands/workspace.js' // 转发工作区增删查请求。
import Session from './commands/session.js' // 转发会话和 SSE 请求。
import Agent from './commands/agent.js' // 接收消息与停止 Agent。
import Permission from './features/permission.js' // 接收用户审批决定。
import Compact from './features/compact.js' // 暴露手动上下文压缩。
import Checkpoint from './features/checkpoint.js' // 暴露回滚和撤销。
import Fork from './features/fork.js' // 暴露历史分叉。
import Plugin from './features/plugin.js' // 管理插件生命周期和 API 注入。
import Tool from './utils/tool.js' // 查询当前工作区可用工具。
import LLM from './utils/llm.js' // 注入统一模型调用能力给插件。

Plugin.setAPI({ Agent, Session, LLM, Store }) // 插件只通过公开内核能力工作。
let server // 保存当前监听实例，供 shutdown 关闭。

const id = t.Object({ id: t.String() }) // 复用普通资源 ID 查询结构。
const sessionID = t.Object({ sessionID: t.String() }) // 复用会话动作请求结构。
const message = t.Object({
    id: t.String(), role: t.Literal('user'),
    parts: t.Array(t.Object({ type: t.String() }, { additionalProperties: true })),
}, { additionalProperties: true })
const sessionFields = t.Partial(t.Object({ provider: t.String(), model: t.String(), title: t.String() }))
const sessionPatch = t.Intersect([id, sessionFields]) // 更新请求同时要求 ID 和可选字段。
const positionRequest = t.Object({ sessionID: t.String(), messageID: t.String(), partIndex: t.Integer({ minimum: 0 }) })
const pluginBody = t.Optional(t.Object({ name: t.Optional(t.String()) })) // 空 body 表示全量扫描插件。

const app = new Elysia()
    .onError(({ code, error, status }) => status(code === 'VALIDATION' ? 422 : 400, { error: error.message }))
    .onBeforeHandle(({ path, cookie, status }) => {
        const publicPath = path === '/health' || path === '/login' // 探活和登录不依赖旧 cookie。
        if (!publicPath && !Auth.verify(cookie.agent?.value)) return status(401) // 私有路由统一拦截。
    })

    // 登录与配置。
    .get('/health', () => ({ ok: true }))
    .post('/login', ({ body, cookie, status }) => {
        const token = Auth.login(body.username, body.password) // 校验凭据并创建本次登录票据。
        if (!token) return status(401, { error: 'Invalid credentials' }) // 凭据错误不写 cookie。
        cookie.agent.set({ value: token, httpOnly: true, sameSite: 'strict', path: '/' })
        return { ok: true } // 只向页面确认登录成功。
    }, { body: t.Object({ username: t.String(), password: t.String() }) })
    .post('/logout', ({ cookie }) => {
        Auth.logout(cookie.agent.value) // 先让服务端票据失效。
        cookie.agent.remove() // 再清除浏览器 cookie。
        return { ok: true } // 注销请求始终返回成功。
    })
    .get('/config', () => Config.read())
    .patch('/config', ({ body }) => Config.save(body), { body: t.Partial(t.Record(t.String(), t.Any())) })

    // 工作区与会话元数据。
    .get('/workspace', () => Workspace.list())
    .post('/workspace', ({ body }) => Workspace.add(body.path), { body: t.Object({ path: t.String() }) })
    .delete('/workspace', ({ query }) => Workspace.remove(query.id), { query: id })
    .get('/session', ({ query }) => Session.read(query.id), { query: id })
    .post('/session', ({ body }) => Session.create(body.workspaceID, body.provider, body.model), {
        body: t.Object({ workspaceID: t.String(), provider: t.String(), model: t.String() }),
    })
    .patch('/session', ({ body: { id, ...patch } }) => Session.update(id, patch), { body: sessionPatch })
    .delete('/session', ({ query }) => Session.remove(query.id), { query: id })

    // Agent 工作和实时事件。
    .post('/agent/send', ({ body }) => Agent.send(body.sessionID, body.message), {
        body: t.Object({ sessionID: t.String(), message: t.Union([t.String(), message]) }),
    })
    .post('/agent/stop', ({ body }) => Agent.stop(body.sessionID), { body: sessionID })
    .get('/session/events', ({ query }) => createUIMessageStreamResponse({
        stream: Session.listen(query.sessionID),
    }), { query: sessionID })
    .post('/permission/decide', ({ body }) => Permission.decide(body.sessionID, body.callID, body.action, body.scope), {
        body: t.Object({
            sessionID: t.String(), callID: t.String(),
            action: t.Union([t.Literal('allow'), t.Literal('deny')]),
            scope: t.Union([t.Literal('once'), t.Literal('always')]),
        }),
    })

    // 历史压缩、回滚与分叉。
    .post('/session/compact', ({ body }) => Compact.run(body.sessionID), { body: sessionID })
    .post('/checkpoint/rollback', ({ body }) => Checkpoint.rollback(body.sessionID, body), { body: positionRequest })
    .post('/checkpoint/undo', ({ body }) => Checkpoint.undo(body.sessionID), { body: sessionID })
    .post('/session/fork', ({ body }) => Fork.create(body.sessionID, body), { body: positionRequest })

    // 插件和工具目录查询。
    .get('/plugin', () => Plugin.list())
    .post('/plugin', ({ body }) => Plugin.load(body?.name), { body: pluginBody })
    .delete('/plugin', ({ query }) => Plugin.unload(query.name), { query: t.Object({ name: t.String() }) })
    .get('/tool', ({ query }) => Tool.list(query.workspacePath), { query: t.Object({ workspacePath: t.String() }) })

export const start = async (port = Number(process.env.PORT || 4632)) => {
    await Store.load() // 先恢复配置、工作区和会话。
    await Plugin.load() // 数据就绪后再启动依赖配置的插件。
    server = app.listen({ port, hostname: process.env.HOST || '127.0.0.1' }).server // 最后开放端口。
    return server // 交给测试或宿主控制监听实例。
}

export const shutdown = async () => {
    Object.keys(Store.runtimes).forEach(Agent.stop) // 先取消所有模型、工具和后台标题请求。
    while (Object.values(Store.runtimes).some(runtime => runtime.status === 'running')) await Bun.sleep(5) // 等循环收尾。

    const unloaded = await Promise.allSettled(Plugin.list().map(Plugin.unload)) // 每个插件都有机会释放资源。
    const domains = ['config', 'workspaces', ...Object.keys(Store.sessions)] // 收集所有持久化域。
    const saved = await Promise.allSettled(domains.map(domain => Store.save(domain))) // 等待每个写入完成。
    const failure = [...unloaded, ...saved].find(result => result.status === 'rejected')?.reason // 保留首个错误。
    await server?.stop(true) // 即使清理失败也必须关闭 HTTP 服务。
    server = null // 清空实例，允许测试再次启动。
    if (failure) throw failure // 资源都清理后再向宿主报告错误。
}

if (import.meta.main) {
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void shutdown()) // 系统信号只处理一次。
    await start() // 直接执行文件时自动启动服务。
    console.log(`Agent listening on http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 4632}`)
}
