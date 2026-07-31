/*
会话 HTTP 插件：暴露会话、任务和历史回退资源，所有持久化修改交给 Session 指令。
运行中冲突在路由边界转换为稳定反馈，不在 HTTP 层直接修改会话状态。
调用示例：new Elysia().use(sessionRoutes)。
*/
import { Elysia } from 'elysia'                       // 引入可组合的路由插件能力
import { Chat } from '../commands/chat.js'            // 引入会话运行状态查询
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


export const sessionRoutes = new Elysia({ name: 'agent.routes.session', prefix: '/session' }) // 会话 API 使用独立前缀插件
  .use(Schemas)                                        // 继承集中注册的请求模型
  .post('/create', () => Session.create())             // 创建新的空会话
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
    async ({ params }) => Chat.isRunning(params.id)
      ? Responses.error(409, 'session is running')
      : Responses.command(await Session.remove(params.id), 404),
  )
  .post(
    '/:id/rollback/:step',                             // 回退到工具存档点
    ({ params }) => Chat.isRunning(params.id)
      ? { ok: false, error: 'session is running' }
      : Session.rollback(params.id, Number(params.step)),
  )
  .post(
    '/:id/rollback-message',                           // 回退指定用户消息供编辑重发
    ({ params, body }) => Chat.isRunning(params.id)
      ? { ok: false, error: 'session is running' }
      : Session.rollbackMessage(params.id, body.messageId),
    { body: 'RollbackMessage' },
  )
  .post(
    '/:id/undo-rollback',                              // 恢复最近一次暂存回退
    ({ params }) => Chat.isRunning(params.id)
      ? { ok: false, error: 'session is running' }
      : Session.undoRollback(params.id),
  )
