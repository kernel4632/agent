/*
 * Web 服务入口：接收 HTTP 触发，交给对应的指令，再按状态码把错误发回去。
 *
 * 本文件只做四件事：注册路由、把错误转成 HTTP 反馈、提供服务状态、启动服务。
 * 业务读写都在 commands/ 和 features/ 里完成；根目录不再有第二层业务目录。
 *
 * 路由一共 19 条，分三层：
 *   基座    /agent/*（发、继续、停、审批）+ /sse/connect + /session/{list,create,read,compact} + /health
 *   会话    /session 下其余动作（分支、改名、设置、回退、撤销回退、删除、分段历史）
 *   管理    /admin 一条总线，设置页和能力页的 29 个动作都在 op 里
 * 加接口前先问自己属于哪层：管理动作进 /admin 的 op 表，不要新开路由。
 *
 * 调用示例：
 *   await start({ port: 3000 })
 *   await app.handle(new Request('http://localhost/health'))   // 测试里直接调用
 */

import { Elysia, t } from 'elysia'
import Admin from './commands/admin.js'
import Chat from './commands/chat.js'
import Session from './commands/session.js'
import Settings from './commands/settings.js'
import Extension from './features/extension.js'
import History from './features/history.js'
import Mcp from './features/mcp.js'
import Storage from './features/storage.js'
import { cleanup } from './utils/process.js'
import SSE from './utils/sse.js'

const app = new Elysia()

// --- 校验错误转成一句话 ---
// Elysia 校验失败时 error.message 是一整块 JSON（type/on/property/message），
// 直接返回给前端会变成一坨转义文本。这里取出“哪个字段、错在哪”拼成可读的一句。
const validationMessage = error => {
    let detail = error?.message ?? ''
    try { detail = JSON.parse(detail) } catch { return String(detail) }
    const field = String(detail?.property || '').replace(/^\//, '').replace(/\//g, '.')
    const where = detail?.on === 'params' ? '路径参数' : detail?.on === 'query' ? '查询参数' : '请求体'
    const reason = detail?.message || '格式不正确'
    return field ? `${where}里的 ${field} 不对：${reason}` : `${where}格式不对：${reason}`
}

// --- gzip 压缩：JSON 响应在客户端支持时压缩，28MB → 10MB ---
// SSE 不压缩（fetch 不会为 EventStream 解压，只会为 Response.body 解压）。
const compress = response => {
    if (typeof response !== 'object' || response.constructor !== Object) return response
    return new Response(JSON.stringify(response), {
        headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
    })
}

const shouldCompress = request => {
    const header = request.headers.get('accept-encoding') || ''
    return /\bgzip\b/i.test(header)
}

app.onAfterHandle(({ request, response, set }) => {
    // Response 已经是原始对象、SVG 或下载，不再包一次。
    if (response instanceof Response) return response
    // SSE 走 EventStream，fetch 不会解压，跳过。
    if (set.headers['content-type'] === 'text/event-stream') return response
    // 客户端支持 gzip 且响应体是 JSON 对象时压缩。
    if (shouldCompress(request) && typeof response === 'object' && response.constructor === Object) {
        const body = JSON.stringify(response)
        return new Response(Bun.gzipSync(body), {
            headers: {
                'content-type': 'application/json',
                'content-encoding': 'gzip',
            },
        })
    }
    return response
})

// --- 转换业务错误 ---
app.onError(({ error, set, code }) => {
    // 入参形状不对是用户能自己改的。状态码沿用项目既有约定 400（契约里一直这么返回），
    // 只把 Elysia 那块嵌套 JSON 改写成一句可读的话。
    if (code === 'VALIDATION') {
        set.status = 400
        return { error: validationMessage(error) }
    }
    // 指令抛出的错误自带状态码；没有状态码的说明是程序问题，按 500 返回并带上原因。
    set.status = error.status || 500
    return { error: error.message }
})

// --- 入参形状：会话编号是所有会话路由的必备路径参数 ---
// 只校形状，不做业务判断（会话在不在、目录存不存在仍由指令层检查）：
// 形状不对在进 handler 之前就返回 400，不用每个 command 各自记得写类型检查。
const SessionParams = t.Object({ sessionId: t.String() })
const MessagePart = t.Object({
    type: t.String(),
    text: t.Optional(t.String()),
    image: t.Optional(t.String()),
})

// --- 服务状态 ---
app.get('/health', async () => ({
    ...await Settings.health(),
    sessions: Session.count(),
    running: Session.running(),
}))

// --- 管理总线：设置页 / 能力页的全部动作 ---
// GET 只给 model.icon，因为它要直接当 <img src>；其余一律 POST，body 里带 op。
app.get('/admin', ({ query }) => Admin.get(query))
app.post('/admin', ({ body }) => Admin.run(body || {}))

// --- 对话：发送、继续、停止、审批 ---
app.group('/agent', agent => agent
    .post('/send/:sessionId', ({ params, body }) => Chat.send({ ...params, ...body }), {
        params: SessionParams,
        // 正文可以是纯字符串，也可以是带图片的内容块数组；具体图片校验在 Chat.normalizeInput。
        body: t.Object({ input: t.Union([t.String(), t.Array(MessagePart)]) }),
    })
    .post('/resume/:sessionId', ({ params }) => Chat.resume(params), { params: SessionParams })
    .post('/stop/:sessionId', ({ params, body }) => Chat.stop({ ...params, ...(body || {}) }), { params: SessionParams })
    .post('/decide/:sessionId', ({ params, body }) => Chat.decide({ ...params, ...body }), {
        params: SessionParams,
        // 只有两个值：放行这一次，或拒绝这一次。长期规则在「工具自动批准」里设。
        body: t.Object({ toolCallId: t.String(), decision: t.String() }),
    }))

// --- 会话 ---
app.group('/session', session => session
    // 列表带上分组：分组只是显示顺序，不需要单独一条接口。
    .get('/list', ({ query }) => Session.list({ search: query.search }))
    .post('/create', ({ body }) => Session.create(body || {}), {
        // 标题必填（空白由指令层 trim 后再判，这里只管“给了个字符串”）
        body: t.Object({ title: t.String(), cwd: t.Optional(t.String()), provider: t.Optional(t.String()), model: t.Optional(t.String()) }),
    })
    .post('/fork/:sessionId', ({ params, body }) => Session.fork({ ...params, ...(body || {}) }))
    // ?after=<messageId>  增量读，只返回该消息之后的新内容（finishRun / stop / 重连用）
    // ?segmented=true      只返回 manifest + 当前段，首次打开有历史的长会话用
    // ?segment=<segmentId> 读某一个封存段的消息，折叠的历史段展开时用
    .get('/read/:sessionId', ({ params, query }) => Session.read({ ...params, ...query }))
    .patch('/rename/:sessionId', ({ params, body }) => Session.rename({ ...params, ...body }), {
        params: SessionParams,
        body: t.Object({ title: t.String() }),
    })
    // 会话级设置都走这一条：思考强度、模型、当前目录。
    .get('/settings/:sessionId', ({ params }) => Session.settings(params))
    .patch('/settings/:sessionId', ({ params, body }) => Session.patch({ ...params, ...(body || {}) }), {
        params: SessionParams,
        body: t.Object({
            reasoning: t.Optional(t.String()),
            provider: t.Optional(t.String()),
            model: t.Optional(t.String()),
            cwd: t.Optional(t.String()),
        }),
    })
    // 回退：给 messageId 退对话，给 toolCallId 只退那一次工具改的文件。
    .post('/rollback/:sessionId', ({ params, body }) => Session.rollback({ ...params, ...(body || {}) }))
    .post('/rollback/redo/:sessionId', ({ params, body }) => Session.redo({ ...params, ...(body || {}) }))
    .delete('/remove/:sessionId', ({ params }) => Session.remove(params))
    .post('/compact/:sessionId', ({ params, request, server }) => {
        // 模型生成总结前不会写响应字节，不能让 HTTP 空闲计时提前断开。
        server?.timeout(request, 0)
        return Session.compact(params)
    }))

// --- SSE ---
app.group('/sse', sse => sse
    .get('/connect/:sessionId', ({ params, request }) => SSE.connect({ id: params.sessionId, request })))

const start = async ({ port = process.env.PORT || 3000 } = {}) => {
    await Storage.prepare()   // 先确定 sessions/ 的位置，再做任何会话读写
    await History.prepare()   // 数据目录先建好，后面所有读写都不用再判断目录在不在。
    await Settings.read()     // 权限规则和模型配置读一次即可。
    await Extension.load(Admin.OPS)    // 加载扩展：传入 Admin.OPS，让扩展能注册 op

    // MCP 连接慢不该挡住打开会话：启动后在后台预热，界面切换只读历史。
    Mcp.warm().catch(error => console.error(`[mcp] 预热连接失败：${error.message}`))

    // 后端退出时带走还挂着的后台进程，不留孤儿；正常退出和 Ctrl+C 都走这里。
    process.on('exit', () => cleanup())
    process.on('SIGINT', () => { cleanup(); process.exit(0) })
    process.on('SIGTERM', () => { cleanup(); process.exit(0) })

    const server = app.listen(port)

    // 重启后自动接住被打断的任务：等端口开始服务后再恢复，恢复期间的请求不会撞上半初始化状态。
    // 续跑是异步的，不挡启动；单条会话失败由 recover 自己记日志。
    Chat.recover().catch(error => console.error(`[recovery] 启动续跑失败：${error.message}`))

    return server
}

export { app, start }

if (import.meta.main) {
    const port = process.env.PORT || 3000
    start({ port }).then(() => console.log(`Agent server listening on http://localhost:${port}`))
}
