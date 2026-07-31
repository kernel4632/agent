# HTTP API

## 基础约定

- 默认地址：`http://127.0.0.1:4632`；端口被占用时 Server 自动递增。
- 普通接口返回 JSON；`POST /chat/send` 返回 `text/event-stream`。
- 请求体由 `server/schemas.js` 统一校验。
- Command 业务失败通常返回 `{ "ok": false, "error": "..." }` 和对应 HTTP 状态。
- 当前共 30 个公开 HTTP 入口。

## Health

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 返回 `{ ok: true }` |

## Agent

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/agent/list` | 列出 Agent 定义 |
| GET | `/agent/:id` | 读取 Agent 定义，不存在返回 404 |
| POST | `/agent` | 新增 Agent |
| PUT | `/agent/:id` | 更新 Agent |

Agent 请求体：

```json
{
  "name": "Coder",
  "provider": "openai",
  "model": "gpt-5",
  "systemPrompt": "You are a coding agent."
}
```

Agent 只配置模型身份，不单独配置权限、工具、MCP、LSP、Skills 或工作区。删除 Agent 和修改默认 Agent 当前通过 `PUT /config` 更新完整配置完成。

## Session

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/session/create` | 创建 Session，可选 `{ agentId }` |
| GET | `/session/list` | 返回 Session 摘要列表 |
| GET | `/session/:id` | 返回完整公开 Session |
| PATCH | `/session/:id` | 使用 `{ title }` 修改标题 |
| DELETE | `/session/:id` | 删除非运行中 Session |
| GET | `/session/:id/tasks` | 返回任务和 `taskRevision` |
| PUT | `/session/:id/tasks` | 替换任务，可携带修订号避免覆盖 |
| POST | `/session/:id/rollback/:step` | 回退到工具步骤 |
| POST | `/session/:id/rollback-message` | 使用 `{ messageId }` 回退用户消息 |
| POST | `/session/:id/undo-rollback` | 撤销最近一次暂存回退 |

Session 创建响应包含绑定的 `agentID`。省略时使用 `defaultAgentId`。

## Chat

### 发送消息

```http
POST /chat/send
Content-Type: application/json
Accept: text/event-stream
```

```json
{
  "sessionId": "ses_xxx",
  "agentId": "default",
  "messageId": "msg_xxx",
  "message": "检查项目并运行测试"
}
```

`sessionId` 可省略，Server 会创建 Session 并先发送 `session-created`。`agentId` 可省略，Server 使用 `defaultAgentId`；当前已有 Session 的 `agentID` 不会作为该字段的隐式回退，因此客户端继续会话时也应显式发送已选 Agent。Run 创建后固定 Agent 快照。

同一 Session 已有根 Run 时返回 `409 session is running`。不同 Session 可以并行。

### 停止执行

```http
POST /chat/stop
```

```json
{ "runId": "run_xxx" }
```

优先使用 `runId`。兼容旧客户端时也接受 `{ "sessionId": "ses_xxx" }`。

### 工具审批

```http
POST /chat/approval
```

```json
{
  "sessionId": "ses_xxx",
  "runId": "run_xxx",
  "toolCallId": "call_xxx",
  "decision": "allow-once"
}
```

`decision`：

- `deny`：拒绝本次工具调用。
- `allow-once`：只允许本次工具调用。
- `always-allow`：允许本次调用，并把规则持久化到权限配置。

`runId` 在存在 Child Run 时用于精确定位。省略后只有唯一匹配审批时才成功；多个 Run 存在同名 `toolCallId` 时返回 `409`。同一决定不能重复消费。

兼容入口：

| 方法 | 路径 | 等价行为 |
|---|---|---|
| POST | `/chat/approve` | `allow-once`，请求体为 `sessionId + toolCallId` |
| POST | `/chat/reject` | `deny`，请求体为 `sessionId + toolCallId` |

## Run

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/session/:id/runs` | 列出 Session 的根 Run 和 Child Run |
| GET | `/run/:id` | 读取公开 Run，不返回 `AbortController` |
| POST | `/run/:id/stop` | 停止目标 Run 及全部后代 |

Run 公开结构：

```json
{
  "id": "run_xxx",
  "sessionID": "ses_xxx",
  "agentID": "default",
  "parentRunID": null,
  "status": "running",
  "input": "用户消息",
  "result": null,
  "error": "",
  "createdAt": 0,
  "startedAt": 0,
  "finishedAt": null,
  "depth": 0
}
```

状态值：`queued`、`running`、`waiting_approval`、`completed`、`failed`、`cancelled`。

## Tools And Capabilities

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/tool/list` | 列出模型可见工具 |
| POST | `/tool/reload` | 重扫内置和自定义工具目录 |
| GET | `/capability/list` | 汇总 Tools、MCP、LSP、Skills 和扫描错误 |
| POST | `/capability/reload` | 并行重建 MCP、LSP 和 Skills |

## Config

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/config` | 返回脱敏后的归一化配置 |
| PUT | `/config` | 保存并立即应用配置 |
| POST | `/config/test` | 测试已保存 Provider 和可选模型 |

`GET /config` 将 API Key、认证 Header、MCP Header 和敏感环境变量替换为 `[REDACTED]`。更新时 `[REDACTED]` 表示保留已有密钥，不是写入字面值。

测试 Provider 请求：

```json
{ "provider": "openai", "model": "gpt-5" }
```

## 客户端要求

1. 使用 `run-created` 返回的 `runID` 执行停止和审批。
2. 将所有 SSE 事件按 `runID` 分配给对应 RunTree 节点。
3. `session-created` 到达后立即更新后续请求使用的 Session ID。
4. 只把 HTTP 2xx 视为成功，并展示服务端 `error`。
5. 不依赖进程重启后的 Run 查询；Run 当前不是持久化资源。
