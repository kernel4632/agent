/*
 * Web 服务入口：装配有状态模块，接收 HTTP 触发，交给对应的指令，再按状态码把错误发回去。
 *
 * 本文件只做五件事：装配有状态模块、注册路由、把错误转成 HTTP 反馈、提供服务状态、启动服务。
 * 业务读写都在 commands/ 和 features/ 里完成；根目录不再有第二层业务目录。
 *
 * 调用示例：
 *   await start({ port: 3000 })
 *   await app.handle(new Request('http://localhost/config/read'))   // 测试里直接调用
 */

import { Elysia } from 'elysia'
import Capabilities from './commands/capabilities.js'
import Chat from './commands/chat.js'
import Filesystem from './commands/filesystem.js'
import Session from './commands/session.js'
import Settings from './commands/settings.js'
import StorageCommand from './commands/storage.js'
import Agent from './features/agent.js'
import Approval from './features/approval.js'
import Config from './features/config.js'
import Context from './features/context.js'
import History from './features/history.js'
import Mcp from './features/mcp.js'
import ModelIcons from './features/model-icons.js'
import SessionGroups from './features/session-groups.js'
import Storage from './features/storage.js'
import Tool from './features/tool.js'
import { cleanup } from './utils/process.js'
import SSE from './utils/sse.js'

// --- 装配有状态模块：feature 之间不互相 import，需要的兄弟服务在这里接起来 ---
Mcp.bind({ config: Config })                                                         // MCP 服务增删改后把配置写回磁盘
Tool.bind({ mcp: Mcp })                                                              // 工具表里要能取到 MCP 服务给的工具
Approval.bind({ tool: Tool, config: Config })                                        // 审批要查工具类别，并把“始终允许”写回配置
Config.bind({ onConfigChange: () => Approval.recheck() })                            // 配置变了，等待中的审批按新规则重问
Agent.bind({ history: History, tool: Tool, approval: Approval, context: Context })   // 会话装配要读历史、工具表、审批和上下文

const app = new Elysia()

// --- 转换业务错误 ---
app.onError(({ error, set }) => {
    // 指令抛出的错误自带状态码；没有状态码的说明是程序问题，按 500 返回并带上原因。
    set.status = error.status || 500
    return { error: error.message }
})

// --- 服务状态 ---
app.get('/health', async () => ({
    ...await Settings.health(),
    sessions: Session.count(),
    running: Session.runningCount(),
}))

// --- 工具目录 ---
app.get('/tool/list', () => Settings.listTools())
app.get('/tool/kinds', () => Settings.toolKinds())

// --- 模型 family 与远程 logo：目录由 models.dev 提供，服务端缓存，前端只发起图片请求 ---
app.group('/model', model => model
    .get('/family', ({ query }) => ModelIcons.suggest({ model: query.model, family: query.family }))
    .get('/icon', async ({ query, set }) => {
        const body = await ModelIcons.icon({ model: query.model, family: query.family, theme: query.theme })
        if (!body) {
            set.status = 404
            return 'Not found'
        }
        set.headers['content-type'] = 'image/svg+xml'
        set.headers['cache-control'] = 'public, max-age=3600'
        return body
    }))

// --- 本机 MCP 与技能：识别、导入和日常维护 ---
app.group('/mcp', mcp => mcp
    .get('/list', ({ query }) => Capabilities.mcpList({ cwd: query.cwd }))
    .post('/save', ({ body }) => Capabilities.mcpSave(body || {}))
    .post('/import', ({ body }) => Capabilities.mcpImport(body || {}))
    .post('/remove', ({ body }) => Capabilities.mcpRemove(body || {}))
    .patch('/toggle', ({ body }) => Capabilities.mcpToggle(body || {}))
    .post('/test', ({ body }) => Capabilities.mcpTest(body || {})))

app.group('/skill', skill => skill
    .get('/list', ({ query }) => Capabilities.skillList({ cwd: query.cwd }))
    .get('/read', ({ query }) => Capabilities.skillRead({ name: query.name, cwd: query.cwd }))
    .post('/save', ({ body }) => Capabilities.skillSave(body || {}))
    .post('/remove', ({ body }) => Capabilities.skillRemove(body || {}))
    .patch('/toggle', ({ body }) => Capabilities.skillToggle(body || {}))
    .patch('/source', ({ body }) => Capabilities.skillSource(body || {})))

// --- 对话：发送、继续、停止、审批 ---
app.group('/agent', agent => agent
    .post('/send/:sessionId', ({ params, body }) => Chat.send({ ...params, ...body }))
    .post('/resume/:sessionId', ({ params }) => Chat.resume(params))
    .post('/stop/:sessionId', ({ params, body }) => Chat.stop({ ...params, ...(body || {}) }))
    .post('/decide/:sessionId', ({ params, body }) => Chat.decide({ ...params, ...body })))

// --- 会话 ---
app.group('/session', session => session
    .get('/list', ({ query }) => Session.list({ search: query.search }))
    .get('/groups', () => SessionGroups.read())
    .put('/groups', ({ body }) => SessionGroups.save(body || {}))
    .post('/create', ({ body }) => Session.create(body || {}))
    .post('/fork/:sessionId', ({ params, body }) => Session.fork({ ...params, ...(body || {}) }))
    .get('/read/:sessionId', ({ params }) => Session.read(params))
    .get('/history/:sessionId', ({ params, query }) => Session.historyPage({
        ...params,
        before: query.before === undefined ? undefined : Number(query.before),
        beforeOffset: query.beforeOffset === undefined ? undefined : Number(query.beforeOffset),
        limit: query.limit === undefined ? undefined : Number(query.limit),
    }))
    .get('/outline/:sessionId', ({ params }) => Session.historyOutline(params))
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
    .post('/compact/:sessionId', ({ params, request, server }) => {
        // 模型生成总结前不会写响应字节，不能让 HTTP 空闲计时提前断开。
        server?.timeout(request, 0)
        return Session.compact(params)
    }))

// --- 配置 ---
app.group('/config', config => config
    .get('/read', async () => {
        await Settings.read()
        return Settings.get()
    })
    .get('/meta', () => Settings.meta())
    .get('/backups', () => Settings.backups())
    .get('/backups/:id', ({ params }) => Settings.readBackup(params.id))
    .post('/restore', ({ body }) => Settings.restore(body || {}))
    .get('/export', ({ query, set }) => {
        const secrets = query.secrets === '1'
        set.headers['content-type'] = 'application/json; charset=utf-8'
        set.headers['content-disposition'] = `attachment; filename="agent-config-${secrets ? 'full' : 'masked'}.json"`
        return JSON.stringify(Settings.exportConfig({ secrets }), null, 2)
    })
    .post('/import', ({ body }) => Settings.importConfig(body || {}))
    .patch('/set', ({ body }) => Settings.set(body))
    .post('/test', ({ body }) => Settings.test(body || {})))

// --- 文件系统浏览：设置页路径选择器用，只读目录/文件列表 ---
app.get('/filesystem/entries', ({ query }) => Filesystem.entries(query))

// --- 存储位置：会话数据可以单独放到其他磁盘，迁移在下次启动执行 ---
app.group('/storage', storage => storage
    .get('/sessions', () => StorageCommand.status())
    .put('/sessions', ({ body }) => StorageCommand.setPath(body || {}))
    .delete('/sessions', () => StorageCommand.cancel()))

// --- SSE ---
app.group('/sse', sse => sse
    .get('/connect/:sessionId', ({ params, request }) => SSE.connect({ id: params.sessionId, request })))

const start = async ({ port = process.env.PORT || 3000 } = {}) => {
    await Storage.prepare()   // 先确定 sessions/ 的位置，再做任何会话读写
    await History.prepare()   // 数据目录先建好，后面所有读写都不用再判断目录在不在。
    await Settings.read()     // 权限规则和模型配置读一次即可。

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
