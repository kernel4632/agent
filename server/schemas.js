/*
HTTP 请求模型：集中声明所有 Elysia 命名 schema，路由只引用业务名称而不内联 TypeBox 结构。
每个路由插件通过 use(Schemas) 继承同一份校验模型，字段约束与原 API 保持一致。
调用示例：new Elysia().use(Schemas).post('/chat/send', handler, { body: 'ChatSend' })。
*/
import { Elysia, t } from 'elysia'                                // 引入命名模型注册和 TypeBox schema 能力


export const Schemas = new Elysia({ name: 'agent.schemas' })      // 使用插件名称避免多路由组合时重复注册
  .model({
    ChatSend: t.Object({
      sessionId: t.Optional(t.String()),                          // 省略会话 ID 时由服务端自动创建
      messageId: t.Optional(t.String()),                          // 客户端消息 ID 支持稳定回退
      message: t.String({ minLength: 1 }),                        // 空消息没有可执行内容
    }),
    SessionControl: t.Object({
      sessionId: t.String(),                                      // 控制动作必须指向现有会话
    }),
    ToolApproval: t.Object({
      sessionId: t.String(),                                      // 审批所属会话
      toolCallId: t.String(),                                     // 审批对应的工具调用
      decision: t.Union([t.Literal('deny'), t.Literal('allow-once'), t.Literal('always-allow')]), // 支持拒绝、单次和永久允许
    }),
    LegacyToolApproval: t.Object({
      sessionId: t.String(),                                      // 兼容入口仍需指定会话
      toolCallId: t.String(),                                     // 兼容入口仍需指定工具调用
    }),
    SessionTitle: t.Object({
      title: t.String(),                                          // 标题长度和空白由会话指令统一校验
    }),
    SessionTasks: t.Object({
      tasks: t.Array(t.Any()),                                    // 任务内部结构由会话指令返回业务错误
      taskRevision: t.Optional(t.Number({ minimum: 0 })),         // 可选修订号用于检测并发覆盖
    }),
    RollbackMessage: t.Object({
      messageId: t.String(),                                      // 回退到指定用户消息
    }),
    ConfigUpdate: t.Record(t.String(), t.Any()),                  // 配置指令负责归一化支持的业务字段
    ConfigTest: t.Object({
      provider: t.String(),                                       // 测试已保存的提供商身份
      model: t.Optional(t.String()),                              // 未指定时使用提供商首个模型
    }),
  })
