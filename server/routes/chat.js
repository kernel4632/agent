/*
对话 HTTP 插件：接收消息、停止请求和工具审批，并将触发交给 Chat 与 Session 指令。
插件继承集中 schema；SSE 和失败结果统一交给 Responses 转换。
调用示例：new Elysia().use(chatRoutes)。
*/
import { Elysia } from 'elysia'                       // 引入可组合的路由插件能力
import { Chat } from '../commands/chat.js'            // 引入 Agent 循环和审批指令
import { Approval } from '../commands/approval.js'    // 引入工具审批决定指令
import { Session } from '../commands/session.js'      // 引入会话创建和查询指令
import { Run } from '../commands/run.js'              // 引入根 Run 创建指令
import { Responses } from '../responses.js'           // 引入统一 HTTP 响应转换器
import { Schemas } from '../schemas.js'               // 引入对话请求命名模型


// --- 接收用户消息并启动 Agent 流 ---
async function send({ body, request }) {
  let sessionID = body.sessionId                       // 已有会话继续原消息历史
  let initialEvents = []                               // 新会话需要先向客户端反馈身份

  if (!sessionID) {
    const session = await Session.create(body.agentId)  // 流启动前按用户选择创建会话
    sessionID = session.id                             // 后续循环统一使用真实会话 ID
    initialEvents = [{ event: 'session-created', data: { id: sessionID } }] // 首个 SSE 事件反馈新身份
  }
  if (!Session.get(sessionID)) return Responses.error(404, 'session not found') // 不允许向不存在的会话写入
  if (Chat.isRunning(sessionID)) return Responses.error(409, 'session is running') // 同一会话不能并发修改历史

  const run = Run.create({ sessionID, agentID: body.agentId, input: body.message }) // 为本轮固定 Agent 选择并登记独立 Run
  initialEvents.push({ event: 'run-created', data: { runID: run.id, agentID: run.agentID, parentRunID: null } }) // 在模型流之前反馈执行归属
  try {
    const stream = Chat.startLoop({ runID: run.id, sessionID, message: body.message, messageID: body.messageId, request, initialEvents }) // 使用独立 Run 启动真实模型循环
    return Responses.sse(stream)                       // 将模型 Web Stream 转为标准 SSE 响应
  } catch (error) {
    Run.fail(run.id, error)                            // 流创建失败时关闭已经登记的 Run
    if (error.code === 'SESSION_RUNNING') return Responses.error(409, error.message) // 处理检查和预留之间的竞争
    throw error                                        // 未知故障交给 Elysia 全局错误处理
  }
}


export const chatRoutes = new Elysia({ name: 'agent.routes.chat', prefix: '/chat' }) // 对话 API 使用独立前缀插件
  .use(Schemas)                                        // 继承集中注册的请求模型
  .post('/send', send, { body: 'ChatSend' })           // 发送消息并返回 SSE
  .post(
    '/stop',                                           // 中断指定 Run 或兼容停止指定会话
    ({ body }) => Chat.stop(body.runId || body.sessionId),
    { body: 'RunControl' },
  )
  .post(
    '/approval',                                       // 处理拒绝、单次允许或永久允许
    async ({ body }) => Responses.command(await Approval.decide({ sessionID: body.sessionId, toolCallID: body.toolCallId, decision: body.decision, runID: body.runId })),
    { body: 'ToolApproval' },
  )
  .post(
    '/approve',                                        // 兼容旧单次允许入口
    async ({ body }) => Responses.command(await Approval.decide({ sessionID: body.sessionId, toolCallID: body.toolCallId, decision: 'allow-once' })),
    { body: 'LegacyToolApproval' },
  )
  .post(
    '/reject',                                         // 兼容旧拒绝入口
    async ({ body }) => Responses.command(await Approval.decide({ sessionID: body.sessionId, toolCallID: body.toolCallId, decision: 'deny' })),
    { body: 'LegacyToolApproval' },
  )
