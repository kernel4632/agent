/*
 * Web 服务入口：接收 HTTP 触发，交给对应的指令，再按状态码把错误发回去。
 *
 * 本文件只做四件事：注册路由、把错误转成 HTTP 反馈、提供服务状态和工作区信息、启动服务。
 * 业务读取、修改和保存都在 config/、session/、safety/ 等主体文件里完成。
 * 调用示例：
 *   await start({ port: 3000 })          // 启动服务
 *   await app.handle(new Request('http://localhost/config/read'))  // 测试里直接调用
 */

import { Elysia } from 'elysia' // 接收 HTTP 触发事件并返回反馈。
import Commands from './workspace/commands.js' // 扫描用户自定义的斜杠命令。
import Agents from './config/agents.js' // 给界面列出内置和自定义智能体。
import Config from './config/config.js' // 执行配置读写指令。
import { USES } from './config/settings.js' // 按用途配模型的标签也由后端给。
import Session from './session/session.js' // 执行会话和 Agent 指令。
import Meta from './session/meta.js' // 启动时准备用户数据目录。
import Tools from './tool/catalog.js' // 给设置页列出全部工具和当前权限。
import Kind from './tool/kind.js' // 给界面列出自动批准类别，避免前端再存一份。
import Ignore from './safety/ignore.js' // 启动时读一次忽略规则。
import Workspace from './workspace/workspace.js' // 读工作区信息和 git 状态。
import Path from './utils/path.js' // 提供配置文件路径。
import Rules from './config/rules.js' // 启动时读一次工作区规则。
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

// --- 斜杠命令 ---
app.get('/command/list', () => Commands.list())

// --- 工具目录 ---
app.get('/tool/list', () => Tools.list())
app.get('/tool/kinds', () => Kind.KINDS)

// --- 注册 Agent 触发事件 ---
// 界面从这里拿内置和自定义智能体的完整定义；配置里只存用户真正写过的覆盖项。
app.group('/agent', agent => agent
    .get('/list', () => Agents.list(Config.get()))
    .post('/send/:sessionId', ({ params, body }) => Session.send({ ...params, ...body }))
    .post('/resume/:sessionId', ({ params }) => Session.resume(params))
    .post('/stop/:sessionId', ({ params, body }) => Session.stop({ ...params, ...(body || {}) }))
    .post('/decide/:sessionId', ({ params, body }) => Session.decide({ ...params, ...body })))
// --- 注册 Session 触发事件 ---
app.group('/session', session => session
    .get('/list', ({ query }) => Session.list({ search: query.search }))
    .post('/create', ({ body }) => Session.create(body || {}))
    // 从现有会话分出一个新分支；可以指定只复制到哪条消息。
    .post('/fork/:sessionId', ({ params, body }) => Session.fork({ ...params, ...body }))
    .get('/read/:sessionId', ({ params }) => Session.read(params))
    .get('/changes/:sessionId', ({ params }) => Session.changes(params))
    // 会话运行设置：智能体、自动批准、能力开关。
    .get('/settings/:sessionId', ({ params }) => Session.readSettings(params))
    .patch('/settings/:sessionId', ({ params, body }) => Session.saveSettings({ ...params, ...body }))
    // 记过哪些工具调用，界面据此列出"可以退回到哪一步"。
    .get('/tools/:sessionId', ({ params }) => Session.toolChanges(params))
    .patch('/rename/:sessionId', ({ params, body }) => Session.rename({ ...params, ...body }))
    // 换这条会话使用的模型；任务在跑时返回 409。
    .patch('/model/:sessionId', ({ params, body }) => Session.setModel({ ...params, ...body }))
    .delete('/remove/:sessionId', ({ params }) => Session.remove(params))
    // files=false 表示只退对话不动文件，用户可以在回退确认框里选。
    .post('/rollback/preview/:sessionId', ({ params, body }) => Session.rollbackPreview({ ...params, ...body }))
    .post('/rollback/:sessionId', ({ params, body }) => Session.rollback({ ...params, ...body }))
    // 工具级回退：只退某一次工具调用改的文件，对话不动。
    .post('/rollback/tool/:sessionId', ({ params, body }) => Session.rollbackTool({ ...params, ...body }))
    .post('/redo/:sessionId', ({ params, body }) => Session.redo({ ...params, ...body }))
    .post('/compact/:sessionId', ({ params }) => Session.compact(params)))
// --- 注册 Config 触发事件 ---
app.group('/config', config => config
    .get('/read', () => Config.read(Path.config()))
    .get('/meta', () => ({ uses: USES })) // 界面标签和默认值这类只读元数据，不写回配置。
    .patch('/set', ({ body }) => Config.set(body))
    .post('/test', ({ body }) => Config.test(body || {}))) // 设置页的"测试连接"按钮走这里。

// --- 注册 SSE 触发事件 ---
app.group('/sse', sse => sse
    .get('/connect/:sessionId', ({ params, request }) => SSE.connect({ id: params.sessionId, request })))

const start = async ({ port = process.env.PORT || 3000 } = {}) => {
    await Meta.prepare() // 数据目录先建好，后面所有读写都不用再判断目录在不在。
    // 权限规则就写在配置的 permission 字段里，读一次配置即可拿到完整运行规则。
    await Config.read(Path.config())
    await Ignore.load() // 忽略规则启动时读一次，之后每次工具调用直接用编译好的规则。
    await Rules.load() // 项目规则也读一次，第一条消息就能用上。
    return app.listen(port)
}

export { app, start }

if (import.meta.main) {
    // 监听成功后打印真实地址，方便用户和日志确认服务开在哪个端口。
    const port = process.env.PORT || 3000
    start({ port }).then(() => console.log(`Agent server listening on http://localhost:${port}`))
}
