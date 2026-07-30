# SSE 事件协议

## 设计原则

**透传优先**：AI SDK 的 `streamText` 产生的流式数据直接透传给前端，不做自定义包装。只有 AI SDK 流中没有的额外信息才使用自定义事件。

这样做的好处：
- 前端可以直接使用 `@ai-sdk/vue` 的 `useChat` 解析标准流
- 减少后端的序列化/反序列化开销
- AI SDK 未来新增的流事件（如新模型特性）自动兼容

## 连接方式

```
POST /chat/send → 响应 Content-Type: text/event-stream
```

## 透传部分（AI SDK 标准流）

Elysia 直接将 AI SDK 的 `toDataStream()` 或 `toUIMessageStream()` 透传给前端。AI SDK 的标准流已包含：

- 文本增量（text delta）
- reasoning/thinking 内容（reasoning delta）
- 工具调用声明（tool call）
- 工具调用结果（tool result）
- 步骤开始/结束标记（step start/finish）
- 完成标记（finish）
- token 用量（usage）

前端使用 AI SDK 的客户端库即可解析这些标准事件，无需额外处理。

## 自定义事件（仅限 AI SDK 流中没有的）

以下事件是我们的额外业务逻辑，不存在于 AI SDK 标准流中，需要自定义：

| 事件 | 数据 | 说明 |
|------|------|------|
| `session-created` | `{ "id": "ses_xxx" }` | 自动创建了新会话（sessionId 为空时触发） |
| `session-title` | `{ "title": "重构登录模块" }` | 异步生成的会话标题 |
| `tool-approval-request` | `{ "id": "tc_001", "name": "write_file", "args": {...} }` | 权限为 ask，暂停等待用户确认 |
| `error-retry` | `{ "message": "API 超时", "attempt": 3, "nextRetryIn": 8000 }` | API 请求失败，正在重试 |

## Elysia 中的实现方式

```javascript
import { Elysia, sse } from 'elysia'

app.post('/chat/send', async function* ({ body }) {
  const { sessionId, message } = body

  // 自定义事件：会话创建
  if (!sessionId) {
    const newSession = Session.create()
    yield sse({ event: 'session-created', data: { id: newSession.id } })
  }

  // Agent 循环内部
  // ...

  // 透传 AI SDK 流
  const result = streamText({ model, system, messages, tools })
  for await (const part of result.fullStream) {
    yield part  // 直接透传 AI SDK 的流式数据
  }

  // 如果遇到 ask 权限
  yield sse({ event: 'tool-approval-request', data: { id, name, args } })
})
```

## 前端消费方式

前端优先使用 `@ai-sdk/vue` 的 `useChat` 处理 AI SDK 标准流部分，同时监听自定义事件：

```javascript
// AI SDK 标准流 — useChat 自动处理
const { messages, sendMessage } = useChat({ api: '/chat/send' })

// 自定义事件 — 手动监听
eventSource.addEventListener('session-created', (e) => { ... })
eventSource.addEventListener('session-title', (e) => { ... })
eventSource.addEventListener('tool-approval-request', (e) => { ... })
eventSource.addEventListener('error-retry', (e) => { ... })
```

## 回退按钮的 step 信息

前端从 AI SDK 标准流中的 tool-result 事件获取 step 字段（在工具执行结果中透传），不需要额外的自定义事件。

## 与之前设计的区别

之前定义了 `reasoning-start`、`reasoning-delta`、`text-delta`、`tool-call`、`tool-result`、`done` 等事件 — 这些全部由 AI SDK 标准流覆盖，不再需要自定义。我们只负责透传。

自定义事件缩减到 4 个，全部是 AI SDK 流中不包含的业务信息。
