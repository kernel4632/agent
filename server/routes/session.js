/*
会话 HTTP 插件：暴露会话、任务和历史回退资源，所有持久化修改交给 Session 指令。
运行中冲突在路由边界转换为稳定反馈，不在 HTTP 层直接修改会话状态。
调用示例：new Elysia().use(sessionRoutes)。
*/
import { Elysia } from 'elysia'                       // 引入可组合的路由插件能力
import { Chat } from '../commands/chat.js'            // 引入会话运行状态查询
import { Approval } from '../commands/approval.js'    // 引入工具审批决定指令
import { Event } from '../commands/event.js'          // 引入独立 SSE 订阅动作
import { History } from '../commands/history.js'      // 引入统一历史动作指令
import { Session } from '../commands/session.js'      // 引入会话资源指令
import { Responses } from '../responses.js'           // 引入统一 HTTP 响应转换器
import { Schemas } from '../schemas.js'               // 引入会话请求命名模型


// --- 读取一个会话详情 ---
function getSession({ params }) {
  const session = Session.get(params.id)               // 从指令读取不会泄漏内部引用的会话副本
  return session ?? Responses.error(404, 'session not found') // 不存在时返回明确资源错误
}


// --- 读取一个会话的任务视图 ---
function getTasks({ params }) {
  const session = Session.get(params.id)               // 任务视图复用公开会话副本
  if (!session) return Responses.error(404, 'session not found') // 不存在的会话没有任务资源

  return { tasks: session.tasks, taskRevision: session.taskRevision } // 只返回任务编辑需要的字段
}


// --- 读取设计契约中的会话详情 ---
function getSessionByQuery({ query }) {
  const session = Session.get(query.sessionId)         // 根据查询参数读取完整公开会话
  return session ?? Responses.error(404, 'session not found') // 不存在时反馈明确资源状态
}


// --- 创建设计契约中的会话 ---
async function createSession({ body }) {
  const result = await Session.create({ workspaceID: body.workspaceId, agentID: body.agentId, model: body.model }) // 创建前由指令验证工作区归属
  return result.ok === false ? Responses.command(result) : result // 成功返回完整会话，失败转换真实 HTTP 状态
}


// --- 启动后台 Agent 执行 ---
async function sendMessage({ body }) {
  return Responses.command(Chat.sendSession(body))      // Route 只触发正式 Session 发送指令
}


// --- 订阅设计契约中的会话事件 ---
function subscribeEvents({ query, request }) {
  if (!Session.get(query.sessionId)) return Responses.error(404, 'session not found') // 不存在的会话没有事件资源
  const headerID = Number(request.headers.get('last-event-id') ?? 0) // 浏览器重连使用最后确认事件 ID
  const queryID = Number(query.afterId ?? 0)                         // 测试和非浏览器客户端可显式传递恢复位置
  const afterID = Number.isFinite(headerID) && headerID > 0 ? headerID : Number.isFinite(queryID) ? queryID : 0 // 请求头优先于查询参数
  return Responses.sse(Event.subscribe(query.sessionId, afterID))   // SSE 连接只订阅反馈，不拥有 Run 生命周期
}


// --- 执行设计契约中的历史动作 ---
export const sessionRoutes = new Elysia({ name: 'agent.routes.session', prefix: '/session' }) // 会话 API 使用独立前缀插件
  .use(Schemas)                                        // 继承集中注册的请求模型
  .get('', getSessionByQuery, { query: 'SessionQuery' }) // 按设计契约获取单个完整会话
  .post('', createSession, { body: 'SessionCreate' })  // 按工作区创建空会话
  .patch('', async ({ body }) => Responses.command(await Session.update(body.sessionId, body)), { body: 'SessionUpdate' }) // 修改标题、Agent 或模型
  .delete('', async ({ body }) => Responses.command(await Session.removeSafely(body.sessionId), 404), { body: 'SessionRemove' }) // 删除会话和磁盘记录
  .post('/send', sendMessage, { body: 'SessionSend' }) // 启动后台执行，增量由 events 接收
  .post('/stop', ({ body }) => Responses.command(Chat.stop(body.sessionId), 404), { body: 'SessionControl' }) // 终止当前会话执行
  .get('/events', subscribeEvents, { query: 'SessionEventsQuery' }) // 建立可重连的独立 SSE 订阅
  .post('/approval', async ({ body }) => Responses.command(await Approval.decide({ sessionID: body.sessionId, toolCallID: body.toolCallId, decision: body.decision, runID: body.runId })), { body: 'ToolApproval' }) // 处理三类工具权限决定
  .post('/history', async ({ body }) => Responses.command(await History.change(body), 404), { body: 'SessionHistory' }) // 处理存档点、消息回退或撤销
  .post('/create', ({ body }) => Session.create({ agentID: body?.agentId })) // 创建绑定 Agent 的空会话，兼容旧客户端
  .get('/list', () => Session.list())                  // 返回全部会话摘要
  .get('/:id', getSession)                             // 返回单个完整会话
  .patch(
    '/:id',                                            // 验证并持久化用户标题
    async ({ params, body }) => Responses.command(await Session.rename(params.id, body.title)),
    { body: 'SessionTitle' },
  )
  .get('/:id/tasks', getTasks)                         // 返回任务清单和修订号
  .put(
    '/:id/tasks',                                      // 替换任务并检测并发修改
    async ({ params, body }) => Responses.command(await Session.updateTasks(params.id, body.tasks, body.taskRevision)),
    { body: 'SessionTasks' },
  )
  .delete(
    '/:id',                                            // 运行中会话拒绝删除
    async ({ params }) => Responses.command(await Session.removeSafely(params.id), 404),
  )
  .post(
    '/:id/rollback/:step',                             // 回退到工具存档点
    async ({ params }) => Responses.command(await History.rollbackCheckpoint(params.id, Number(params.step)), 404),
  )
  .post(
    '/:id/rollback-message',                           // 回退指定用户消息供编辑重发
    async ({ params, body }) => Responses.command(await History.rollbackMessage(params.id, body.messageId), 404),
    { body: 'RollbackMessage' },
  )
  .post(
    '/:id/undo-rollback',                              // 恢复最近一次暂存回退
    async ({ params }) => Responses.command(await History.undo(params.id), 404),
  )
