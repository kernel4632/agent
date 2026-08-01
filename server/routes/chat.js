/*
对话 HTTP 插件：接收消息、停止请求和工具审批，并将触发交给 Chat 与 Session 指令。
插件继承集中 schema；SSE 和失败结果统一交给 Responses 转换。
调用示例：new Elysia().use(chatRoutes)。
*/
import { Elysia } from 'elysia'                       // 引入可组合的路由插件能力
import { Chat } from '../commands/chat.js'            // 引入 Agent 循环和审批指令
import { Approval } from '../commands/approval.js'    // 引入工具审批决定指令
import { Responses } from '../responses.js'           // 引入统一 HTTP 响应转换器
import { Schemas } from '../schemas.js'               // 引入对话请求命名模型


// --- 接收用户消息并启动 Agent 流 ---
async function send({ body, request }) {
  const result = await Chat.sendLegacy({ sessionID: body.sessionId, agentID: body.agentId, message: body.message, messageID: body.messageId, request }) // 将完整触发交给单一对话指令
  return result.ok ? Responses.sse(result.stream) : Responses.command(result) // 入口只适配流或业务错误
}


export const chatRoutes = new Elysia({ name: 'agent.routes.chat', prefix: '/chat' }) // 对话 API 使用独立前缀插件
  .use(Schemas)                                        // 继承集中注册的请求模型
  .post('/send', send, { body: 'ChatSend' })           // 发送消息并返回 SSE
  .post(
    '/stop',                                           // 中断指定 Run 或兼容停止指定会话
    ({ body }) => Responses.command(Chat.stop(body.runId || body.sessionId), 404),
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
