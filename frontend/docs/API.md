# la 前后端接口文档

本文记录本次前端实际对接的已有后端行为，基线为 `174f27c`。以 [server.js](../../server/server.js)、[Session 指令](../../server/commands/session.js)、[Config 指令](../../server/commands/config.js)、[SSE 实现](../../server/utils/sse.js) 为依据。本次交付没有修改 `server/` 或 `core/`，本文也不代表新增后端能力。

前端实现入口：[api.js](../src/api.js)、[chat.js](../src/commands/chat.js)、[session.js](../src/commands/session.js)、[SSE 解析器](../src/utils/sse.js)。

## 1. 地址与传输

| 项目 | 约定 |
| --- | --- |
| 前端开发地址 | `http://127.0.0.1:5173` |
| 默认后端地址 | `http://127.0.0.1:3000` |
| 浏览器请求前缀 | `/api`，例如 `/api/config/read` |
| 代理行为 | Vite 移除 `/api` 前缀后转发给后端 |
| 修改后端地址 | 启动前端前设置 `AGENT_SERVER_URL` |
| 普通请求 | 请求体为 JSON 时设置 `Content-Type: application/json` |
| 事件订阅 | `Accept: text/event-stream`，使用 Fetch 流解析 SSE |
| 认证 | 当前后端没有登录、退出或认证中间件；`credentials: include` 不代表已实现鉴权 |

下文路径均为**后端路径**。浏览器调用时加 `/api`。正式静态部署需要同源反向代理；原始后端没有单独配置 CORS。SSE 转发应关闭缓冲，并允许长连接。

## 2. 路由总表

| 方法 | 路径 | 请求体 | 主要返回 | 前端使用 |
| --- | --- | --- | --- | --- |
| GET | `/config/read` | 无 | 完整配置对象 | 是 |
| PATCH | `/config/set` | 完整配置对象 | 保存后的配置 | 是 |
| POST | `/session/create` | `{ title, provider?, model?, workspaceId? }` | `{ sessionId }` | 是，不发送 `workspaceId` |
| GET | `/session/read/:sessionId` | 无 | 会话元信息与 `history` | 是 |
| PATCH | `/session/rename/:sessionId` | `{ title }` | 会话元信息 | 是 |
| DELETE | `/session/remove/:sessionId` | 无 | `{ ok: true }` | 是 |
| POST | `/session/rollback/:sessionId` | `{ messageId }` | 回退后的完整会话 | 是 |
| POST | `/session/redo/:sessionId` | 无 | 恢复后的完整会话 | 是 |
| POST | `/session/compact/:sessionId` | 可省略 | 完整会话及 `content` | 无前端入口 |
| POST | `/agent/send/:sessionId` | `{ input }` | `{ ok: true }` | 是 |
| POST | `/agent/stop/:sessionId` | 无 | `{ ok: boolean }` | 是 |
| POST | `/agent/decide/:sessionId` | `{ callId, decision }` | `{ ok: boolean }` | 是 |
| GET | `/sse/connect/:sessionId` | 无 | SSE 字节流 | 是 |

不要使用根 README 中的 `/health`、`/workspace`、`/config`、`/session/events` 等路径；当前 `server.js` 没有注册这些接口。创建返回字段是 `sessionId`，不是 `sessionID` 或完整会话对象。

## 3. 配置

### 读取与保存

```http
GET /api/config/read
```

首次启动可能返回 `{}`。配置示例（仅示例值，不含真实凭据）：

```json
{
  "providers": [
    {
      "name": "My Provider",
      "enabled": true,
      "baseURL": "https://model.example.com/v1",
      "apiKey": "YOUR_API_KEY",
      "protocol": "openai-compatible",
      "models": ["my-model"],
      "modelSettings": { "my-model": { "context": 128000 } }
    }
  ],
  "prompt": { "system": "你是一个编程助手。" },
  "permission": { "*": "ask" }
}
```

```http
PATCH /api/config/set
Content-Type: application/json

{ "providers": [], "prompt": { "system": "你是一个编程助手。" } }
```

`PATCH` 在此接口中表示**整体替换**，不是局部合并。上面的最小请求会移除原配置中未包含的字段。前端先读取完整配置，保留未编辑字段，再提交完整对象；保留提供商的 `headers`、`modelSettings` 等参数，以及原有权限、MCP 和提示词附加字段。系统提示词键名是 `prompt.system`，不是 `prompts.system`。

后端支持 `models` 中的字符串或含 `id` 的对象；前端保存已有模型时保留其原始结构。新添加模型使用字符串 ID。

当前读取接口会返回真实 API Key，不提供脱敏占位符还原，也不能假定 `${ENV_NAME}` 会自动解析。界面默认以密码输入展示密钥，不把凭据写入 localStorage。外观偏好使用 `agent.appearance` 独立保存；只改外观不发起配置写请求。后端没有配置版本号，多个客户端同时整体保存存在覆盖风险。

### 模型列表发现

`GET /openai-proxy/models?baseURL=<URL编码后的供应商地址>` 是现有 **Vite 开发/预览中间件**，不是 Agent 后端接口。可传入 `Authorization: Bearer ...`，中间件转发至供应商 `<baseURL>/models`，请求超时为 20 秒。

前端接受 `{ data: [...] }` 或 `{ models: [...] }`，元素可为字符串或含 `id` / `name` 的对象。没有部署该中间件时，仍可手动输入模型 ID。

## 4. 会话与历史

### 创建

```http
POST /api/session/create
Content-Type: application/json

{ "title": "新对话", "provider": "My Provider", "model": "my-model" }
```

```json
{ "sessionId": "example-session-id" }
```

`title` 必须为非空字符串。省略提供商或模型时，后端取第一个启用提供商及其首个模型。前端会紧接着请求读取接口，获得完整会话。虽然后端接受可选 `workspaceId` 元数据，但并没有工作区 CRUD、目录验证或隔离语义；前端不把浏览器分组冒充后端工作区。

### 读取

```http
GET /api/session/read/example-session-id
```

```json
{
  "id": "example-session-id",
  "title": "新对话",
  "provider": "My Provider",
  "model": "my-model",
  "createdAt": 1790000000000,
  "updatedAt": 1790000000000,
  "history": [
    { "messageId": "history-user-id", "id": "core-user-id", "role": "user", "content": "你好" },
    {
      "messageId": "history-assistant-id",
      "id": "core-assistant-id",
      "role": "assistant",
      "content": [{ "type": "text", "text": "你好，有什么可以帮你？" }]
    }
  ]
}
```

时间戳为毫秒。读取结果不保证包含 `status`、`eventID`、`messages` 或 `rollback` 字段。运行时返回的是 Agent 内存历史；尚未持久化的消息可能只有核心 `id`，没有历史存储层的 `messageId`。**回退必须使用已保存历史的 `messageId`，不能拿 `id` 替代**。前端运行期间禁用回退。

`content` 可以为字符串或 AI SDK 内容块数组。常用内容块包括：

```json
[
  { "type": "reasoning", "text": "思考过程" },
  { "type": "text", "text": "消息正文" },
  { "type": "tool-call", "toolCallId": "call-1", "toolName": "read", "input": { "path": "example.txt" } }
]
```

工具结果作为 `role: "tool"` 的消息保存：

```json
{
  "role": "tool",
  "content": [
    { "type": "tool-result", "toolCallId": "call-1", "toolName": "read", "output": { "type": "text", "value": "文件内容" } }
  ]
}
```

前端按 `toolCallId` 将结果合并到工具展示卡片；消息正文经过 Markdown 解析和 HTML 清理后渲染。

### 重命名、删除、回退

| 操作 | 行为 |
| --- | --- |
| 重命名 | `PATCH /session/rename/:sessionId`，提交 `{ title: "新标题" }`，返回元信息而非完整历史 |
| 删除 | `DELETE /session/remove/:sessionId`，永久删除后端会话目录；运行时拒绝 |
| 回退 | `POST /session/rollback/:sessionId`，提交 `{ messageId }`，将目标消息及之后的历史移入 redo；运行时拒绝，不会自动停止 |
| 撤销回退 | `POST /session/redo/:sessionId`，恢复最近一段被回退记录；没有可恢复内容时保持现状；运行时拒绝 |
| 压缩 | 已有 `POST /session/compact/:sessionId`，运行时拒绝；当前指令不使用请求体中的 `maxTokens`，前端不提供入口 |

发送新消息后，后端新历史的追加会清空 redo。当前前端只在本次操作后展示撤销按钮，不声明能够从后端读取完整 redo 状态。

## 5. 发送、停止和审批

### 发送

```http
POST /api/agent/send/example-session-id
Content-Type: application/json

{ "input": "帮我分析这个问题" }
```

返回 `{ "ok": true }` 只表示后台任务已提交，不代表模型执行成功或历史保存完成。结果通过 SSE 获取。后端指令允许向核心传入额外选项，但本前端只发送 `input`，不提供任意内部参数覆盖。

核心 Agent 收到重复 `send` 会停止旧任务再开始新任务，不保证返回 `409`。前端在已知运行状态下阻止重复发送。模型异常可能在后台被 `.catch(() => {})` 吞掉，导致已返回成功但没有终态事件；前端显示等待提示及停止按钮，不把超时当作成功。

文本附件在浏览器读取后追加到 `input` 字符串中，文件名用 JSON 字符串编码。每个附件限制 1 MiB，只支持文本与代码扩展名；没有独立文件上传接口，不支持图片、多模态上传或服务器文件写入。

### 停止

```http
POST /api/agent/stop/example-session-id
```

返回 `{ "ok": true }` 表示停止了运行任务，`{ "ok": false }` 表示没有可停止的 Agent 任务。前端随后重新读取历史。停止不保证立即读到最终持久化状态，最终历史仍以服务器读取结果为准。

### 工具审批

```http
POST /api/agent/decide/example-session-id
Content-Type: application/json

{ "callId": "call-1", "decision": "allow-once" }
```

| `decision` | 语义 |
| --- | --- |
| `deny` | 拒绝本次调用 |
| `allow-once` | 允许本次调用 |
| `allow-always` | 允许本次调用，并由后端保存当前参数匹配规则 |

前端内部的 `always-allow` 在 API 边界转换为 **`allow-always`**。不要提交 `{ action, scope }`。返回 `ok: false` 表示该审批已不存在或不匹配，不能显示为批准成功。“始终允许此参数”不是为该工具全部调用授予通配权限。

## 6. SSE 协议与生命周期

```http
GET /api/sse/connect/example-session-id
Accept: text/event-stream
```

每个事件以空行结束，`data` 为 JSON；这是 SSE，不是 NDJSON。例如：

```text
id: 1
event: message
data: {"type":"agent-start"}

id: 2
data: {"type":"text-delta","text":"你好"}

```

解析器接受缺少 `event` 字段的帧、多行 `data`、CRLF/LF 和跨网络分块的 UTF-8。注释心跳不改变业务状态，后端心跳间隔为 15 秒。

| `data.type` | 主要字段 | 当前前端处理 |
| --- | --- | --- |
| `agent-start` | 无 | 读取当前历史，重建最新用户消息之后的流式轮次，标记运行 |
| `llm-start` | `messages`, `tools` | 接收进度，不直接展示请求上下文 |
| `text-delta` | `text`，兼容 `textDelta` / `delta` | 追加助手正文 |
| `reasoning-delta` | `text`，兼容 `textDelta` / `delta` | 追加思考过程 |
| `llm-finish` | `text`, `usage`, `toolCalls` 等 | 固定本轮文字和用量；工具由独立事件展示 |
| `retry` | `attempt`, `error`, `delay` | 显示重试提示 |
| `tool-call` | `toolCallId`, `toolName`, `input` | 建立或更新运行中的工具卡片 |
| `tool-output` | 调用标识和 `data` / `output` | 追加工具输出；需要可匹配的调用 ID |
| `tool-result` | `toolCallId`, `toolName`, `output` | 展示完成、失败或拒绝结果 |
| `permission` | `callID`, `tool`, `input` | 展示三个审批按钮；注意字段名为 `callID` |
| `agent-finish` | 核心返回的结束信息 | 标记空闲，重新读取后端完整历史 |
| `error` | `errorText` 或 `error.message` | 展示错误；当前服务器不保证后台错误都会发出此事件 |
| 压缩相关事件及其他 AI SDK 事件 | 核心透传字段 | 不提供专用展示，不推断为执行成功 |

工具输出常见结构为 `{ type: "text", value: "..." }`、`{ type: "json", value: {...} }`、`{ type: "error-text", value: "..." }`、`{ type: "execution-denied", reason: "..." }`。字段来自当前工具和核心回调，不能假设每个供应商事件都有相同可选字段。

连接顺序：

1. 读取会话完整历史并渲染。
2. 建立 SSE，接收尚未清理的当前任务缓存和后续事件。
3. 完成后再次读取历史，以后端内容替换流式临时消息。
4. 断线后退避重试，先重新读取会话，再订阅。离开会话时取消订阅。

后端保存历史后清空事件缓存，并把事件编号重置为 `1`。因此 **不发送 `Last-Event-ID` 或 `after` 参数，也不按跨任务单调递增 ID 去重**。同一会话只允许一个连接，新连接会关闭旧连接；多个窗口同时打开同一会话可能互相抢占连接。当前协议也没有原子快照游标或明确运行状态字段，不能据此承诺任意并发、重连场景下的严格一次事件处理。

## 7. 错误响应

路由错误通常返回：

```json
{ "error": "Session not found: example-session-id" }
```

| 状态 | 当前路由层映射 |
| --- | --- |
| 400 | `TypeError`，例如空会话标题 |
| 404 | 错误消息包含 `not found` |
| 409 | 错误消息包含 `already running`，如运行时删除或回退 |
| 500 | 其他错误 |

这是实际错误映射，不是完整参数校验规范。未知路由和异常请求不应被假定总有某一状态。代理返回非 JSON 错误时，前端显示 HTTP 状态及连接提示。普通请求成功也不代表后台 Agent 必然完成。

## 8. 未实现能力与本地数据

| 能力 | 当前处理 |
| --- | --- |
| 工作区管理 | 后端未注册接口，前端入口禁用 |
| 全量会话列表 | 后端未注册接口，使用 `la.session-index.v1` 保存当前浏览器创建或通过 ID 打开的摘要 |
| 已有会话模型切换 | 没有更新接口；仅支持新建时选择模型 |
| 工具、MCP、数据管理 | 不开放管理操作；配置写入保留已有相关字段 |
| 登录或远程认证 | 没有对应接口，不创建伪登录流程 |
| 图片/二进制上传 | 不支持 |
| 工具步骤 checkpoint 回退 | 没有对应 API，仅支持历史消息回退 |

浏览器索引不是后端会话数据库，也不是权限边界。清除本地存储会丢失索引，不删除后端历史。可使用会话页的复制 ID 按钮，在另一浏览器通过 ID 重新打开。

## 9. 最小浏览器调用示例

以下代码需要从已配置同源代理的前端页面运行，且后端已配置有效模型：

```js
const created = await fetch('/api/session/create', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ title: '接口验证', provider: 'My Provider', model: 'my-model' }),
})
if (!created.ok) throw new Error('创建会话失败')
const { sessionId } = await created.json()
const encodedID = encodeURIComponent(sessionId)
const initial = await fetch(`/api/session/read/${encodedID}`).then(response => response.json())
console.log(initial.title) // 不打印配置凭据或完整模型请求上下文

const controller = new AbortController()
const stream = await fetch(`/api/sse/connect/${encodedID}`, {
  headers: { accept: 'text/event-stream' },
  signal: controller.signal,
})
// 使用 frontend/src/utils/sse.js 的 readSSE 消费 stream；不要对 SSE 调用 response.json()。
const sent = await fetch(`/api/agent/send/${encodedID}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ input: '请回复你好' }),
})
if (!sent.ok) throw new Error('提交失败')
// 收到 agent-finish 后再次读取会话。离开时调用 controller.abort()。
```

## 10. 验证范围

- `bun run test`：4 项协议测试，检查 SSE 分帧、UTF-8、HTTP 错误及前端路由契约。
- `bun run test:ui`：12 项桌面/移动浏览器测试，使用受控接口响应验证交互、审批、配置保留、回退和布局。
- 原始后端已完成配置读取、会话创建/读取/重命名/删除、空闲停止的本机验证。
- 真实模型对话未验证；需要使用者配置真实供应商后联调。接口模拟测试不代表模型可用性或后端所有边界行为已通过测试。
