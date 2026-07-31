# SSE 事件协议

## 连接

```http
POST /chat/send
Accept: text/event-stream
Content-Type: application/json
```

该接口使用 POST，请求体包含消息和可选 Session/Agent，因此不能使用浏览器 `EventSource`。前端通过 `fetch()` 读取 `ReadableStream`，并由 `frontend/src/utils/sse.js` 解析标准帧：

```text
event: text-delta
data: {"type":"text-delta","text":"hello"}

```

所有事件都由 Server 编码为 SSE。AI SDK `fullStream` 的非 `finish` part 使用其 `part.type` 作为事件名；业务事件使用稳定自定义名称。

## 归属规则

- 根模型流默认属于最近的 `run-created.runID`。
- Child Run 业务事件显式包含 `runID` 和 `parentRunID`。
- Child Run 的模型增量当前不透传到父 SSE，只反馈创建、审批/任务等带归属事件和最终结果。
- 客户端不得只按 Session 聚合工具审批，必须按 Run 分配。

## 启动事件

| 事件 | 数据 | 触发条件 |
|---|---|---|
| `session-created` | `{ id }` | 请求未提供 `sessionId` |
| `run-created` | `{ runID, agentID, parentRunID: null }` | 根 Run 已登记，模型调用前 |

## AI SDK 流事件

Server 转发 AI SDK `fullStream` 中除原生 `finish` 外的 part。常见事件包括：

| 事件 | 关键字段 | 说明 |
|---|---|---|
| `text-start` / `text-delta` / `text-end` | AI SDK part 原结构 | 最终文本流 |
| `reasoning-start` / `reasoning-delta` / `reasoning-end` | AI SDK part 原结构 | reasoning 流 |
| `tool-input-start` / `tool-input-delta` / `tool-input-end` | AI SDK part 原结构 | 工具参数生成 |
| `tool-call` | `toolCallId`, `toolName`, `input` | 模型声明调用 |
| `tool-result` | `toolCallId`, `toolName`, `output` | 工具执行结果 |
| `source` | AI SDK part 原结构 | Provider 来源信息 |
| `error` | AI SDK part 原结构 | 流内 Provider 错误 part |

客户端应忽略未知 AI SDK 事件，以兼容 SDK 后续新增 part 类型。

## 业务事件

| 事件 | 数据 | 说明 |
|---|---|---|
| `session-title` | `{ title }` | 首条消息后异步生成标题 |
| `task-list-updated` | `{ tasks, taskRevision, runID?, parentRunID? }` | 工具更新任务清单 |
| `checkpoint` | `{ step, toolCallIds }` | 根 Run 本轮工具形成回退点 |
| `error-retry` | `{ message, attempt, nextRetryIn }` | 可恢复模型故障即将重试 |
| `tool-approval-request` | 审批结构 | Run 进入 `waiting_approval` |
| `child-run-created` | `{ runID, parentRunID, agentID, input }` | 创建 Child Run |
| `child-run-finished` | `{ runID, parentRunID, status, result? , error? }` | Child Run 终态 |

Child Run 内触发的 `task-list-updated` 和 `tool-approval-request` 会补充 Child `runID` 与 `parentRunID`。Child Run 当前不向父 SSE 发送 `error-retry`。

审批示例：

```json
{
  "id": "call_xxx",
  "runID": "run_child",
  "parentRunID": "run_root",
  "name": "write_file",
  "args": { "path": "src/app.js" },
  "matchedRule": "*",
  "scope": "argument",
  "target": "src/app.js"
}
```

## 终态事件

根 Run 使用 Server 自定义 `finish`：

```json
{
  "ok": true,
  "sessionID": "ses_xxx",
  "runID": "run_xxx",
  "agentID": "default"
}
```

取消时：

```json
{
  "ok": false,
  "cancelled": true,
  "sessionID": "ses_xxx",
  "runID": "run_xxx",
  "agentID": "default"
}
```

未中止异常使用：

```text
event: error
data: {"message":"Error: ..."}
```

异常流在 `error` 后关闭，当前不会再发送 `finish`。

## 客户端状态更新

```text
session-created -> 设置活动 Session
run-created -> 创建根 RunTree 节点并记录当前 runId
text/reasoning/tool events -> 更新根消息视图
child-run-created -> 添加子节点
tool-approval-request -> 在所属 Run 节点显示审批
child-run-finished -> 写入子节点终态
finish/error -> 结束根运行态并刷新 Session/Run
```

网络流关闭不能单独代表成功；客户端以 `finish.ok`、`finish.cancelled` 或 `error` 判断根 Run 结果。
