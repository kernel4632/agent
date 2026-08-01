/*
HTTP 请求模型：集中声明所有 Elysia 命名 schema，路由只引用业务名称而不内联 TypeBox 结构。
每个路由插件通过 use(Schemas) 继承同一份校验模型，字段约束与原 API 保持一致。
调用示例：new Elysia().use(Schemas).post('/session/send', handler, { body: 'SessionSend' })。
*/
import { Elysia, t } from 'elysia'                                // 引入命名模型注册和 TypeBox schema 能力


export const Schemas = new Elysia({ name: 'agent.schemas' })      // 使用插件名称避免多路由组合时重复注册
  .model({
    WorkspaceCreate: t.Object({
      path: t.String({ minLength: 1 }),                            // 工作区必须绑定真实目录
      name: t.Optional(t.String()),                                // 展示名称可省略并使用目录名
    }),
    WorkspaceUpdate: t.Object({
      workspaceId: t.String(),                                     // 修改动作必须指向稳定工作区身份
      path: t.Optional(t.String()),                                // 可选修改真实目录
      name: t.Optional(t.String()),                                // 可选修改展示名称
    }),
    WorkspaceRemove: t.Object({
      workspaceId: t.String(),                                     // 只移除列表定义，不删除本地目录
    }),
    SessionCreate: t.Object({
      workspaceId: t.Optional(t.String()),                         // 旧客户端省略时使用默认工作区
      model: t.Optional(t.String()),                               // 可选会话模型
    }),
    SessionUpdate: t.Object({
      sessionId: t.String(),                                       // 修改动作必须指向现有会话
      title: t.Optional(t.String()),                               // 可选修改会话标题
      model: t.Optional(t.String()),                               // 可选修改默认模型
    }),
    SessionRemove: t.Object({
      sessionId: t.String(),                                       // 删除动作必须指向现有会话
    }),
    SessionSend: t.Object({
      sessionId: t.String(),                                       // 消息只能发送到已创建会话
      content: t.String({ minLength: 1 }),                         // 用户消息不能为空
      messageId: t.Optional(t.String()),                           // 客户端可提供稳定消息身份
      model: t.Optional(t.String()),                               // 本轮可覆盖会话模型
      files: t.Optional(t.Array(t.Object({
        name: t.String({ minLength: 1 }),                          // 附件显示名称
        type: t.String(),                                          // 浏览器识别的媒体类型
        size: t.Number({ minimum: 0, maximum: 1048576 }),          // 单文件限制一 MiB，避免请求无限膨胀
        content: t.String({ maxLength: 1398104 }),                  // Base64 正文包含编码膨胀空间
      }), { maxItems: 8 })),                                      // 单次消息最多八个附件
    }),
    SessionQuery: t.Object({
      sessionId: t.String({ minLength: 1 }),                         // Session GET 必须提供稳定身份
    }),
    SessionEventsQuery: t.Object({
      sessionId: t.String({ minLength: 1 }),                         // SSE 订阅必须明确所属会话
      afterId: t.Optional(t.Numeric({ minimum: 0 })),                // 恢复位置必须是非负递增事件 ID
    }),
    SessionHistory: t.Object({
      sessionId: t.String(),                                       // 历史动作必须指向现有会话
      action: t.Union([t.Literal('rollback-checkpoint'), t.Literal('rollback-message'), t.Literal('undo')]), // 只接受设计规定的三类动作
      checkpoint: t.Optional(t.Number({ minimum: 1 })),            // 工具回退需要存档点编号
      messageId: t.Optional(t.String()),                           // 消息回退需要用户消息身份
    }),
    SessionControl: t.Object({
      sessionId: t.String(),                                      // 控制动作必须指向现有会话
    }),
    ToolApproval: t.Object({
      sessionId: t.String(),                                      // 审批所属会话
      toolCallId: t.String(),                                     // 审批对应的工具调用
      decision: t.Union([t.Literal('deny'), t.Literal('allow-once'), t.Literal('always-allow')]), // 支持拒绝、单次和永久允许
    }),
    ConfigUpdate: t.Record(t.String(), t.Any()),                  // 配置指令负责归一化支持的业务字段
  })
