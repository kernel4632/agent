# 前端对接文档

这个目录是 Agent 后端。前端只需要通过 HTTP 和 SSE 对接，不需要读取后端源码。

## 从零启动

前端开发者只需要准备 Bun 和一份模型配置。

### 1. 安装 Bun

PowerShell 执行：

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

重新打开终端后，确认 Bun 可用：

```powershell
bun --version
```

### 2. 安装后端依赖

```powershell
cd server
bun install
```

### 3. 选择数据目录

后端把配置、会话和历史保存在数据目录。开发时建议使用独立目录：

```powershell
$env:AGENT_HOME = "C:\temp\agent-data"
```

如果不设置 `AGENT_HOME`，默认目录是：

```text
%USERPROFILE%\.agent
```

### 4. 创建模型配置

在数据目录创建 `config.json`。例如上一步使用了 `C:\temp\agent-data`：

```powershell
New-Item -ItemType Directory -Force "C:\temp\agent-data"
notepad "C:\temp\agent-data\config.json"
```

填入最小配置：

```json
{
  "prompt": {
    "system": "你是一个编程 Agent。",
    "summary": "总结当前会话。",
    "tool": "请使用工具继续完成任务。"
  },
  "providers": [
    {
      "name": "default",
      "enabled": true,
      "baseURL": "https://example.com/v1",
      "apiKey": "你的密钥",
      "protocol": "openai-compatible",
      "models": ["你的模型名"],
      "modelSettings": {
        "你的模型名": { "context": 128000 }
      }
    }
  ],
  "permission": {
    "*": "ask"
  }
}
```

将 `baseURL`、`apiKey`、`models` 和模型名替换为你自己的模型服务信息。

### 5. 启动后端

```powershell
bun start
```

默认地址是：

```text
http://localhost:3000
```

启动后可用浏览器打开下面地址确认配置读取正常：

```text
http://localhost:3000/config/read
```

如果返回 JSON，说明后端已经启动。

### 6. 前端连接

前端的后端地址填写：

```text
http://localhost:3000
```

前端和后端不在同一个域名或端口时，需要看文末的 [部署注意事项](#部署注意事项)。

## 前端打开会话

前端打开一个会话时，固定按下面顺序执行：

```text
1. GET  /session/read/:sessionId
2. 用返回的完整 history 渲染页面
3. GET  /sse/connect/:sessionId
4. 接收仍在运行的流式事件
```

不要让 SSE 负责发送完整 History。History 通过 `Session.read` 获取，SSE 只补充 History 保存之后的流式变化。

断线时：

```text
1. 重新 GET /session/read/:sessionId
2. 用最新 History 重新渲染
3. 重新 GET /sse/connect/:sessionId
```

不要发送 `Last-Event-ID`。后端会从当前缓存的第一条事件开始重放。

## HTTP 接口

所有 JSON 请求使用：

```http
Content-Type: application/json
```

错误响应统一是：

```json
{
  "error": "错误说明"
}
```

常见状态码：

| 状态码 | 含义 |
| --- | --- |
| `400` | 请求参数不正确 |
| `404` | 会话不存在 |
| `409` | 该会话已有 Agent 正在运行 |
| `500` | 后端执行失败 |

### 配置

| 方法 | 地址 | 请求体 | 结果 |
| --- | --- | --- | --- |
| `GET` | `/config/read` | 无 | 当前完整配置 |
| `PATCH` | `/config/set` | 完整新配置 | 保存后的完整配置 |

`PATCH /config/set` 是整体替换，不是局部合并。

> 注意：当前后端会返回完整配置，其中可能含有 `apiKey`。前端展示配置时必须遮蔽密钥，不能直接显示或写入日志。

### 会话

| 方法 | 地址 | 请求体 | 结果 |
| --- | --- | --- | --- |
| `POST` | `/session/create` | `{ "title", "workspaceId?", "provider?", "model?" }` | `{ "sessionId" }` |
| `GET` | `/session/read/:sessionId` | 无 | 会话元信息和完整 History |
| `PATCH` | `/session/rename/:sessionId` | `{ "title" }` | 更新后的会话元信息 |
| `DELETE` | `/session/remove/:sessionId` | 无 | `{ "ok": true }` |
| `POST` | `/session/rollback/:sessionId` | `{ "messageId" }` | 回退后的完整会话 |
| `POST` | `/session/redo/:sessionId` | 无 | 恢复后的完整会话 |
| `POST` | `/session/compact/:sessionId` | `{ "maxTokens" }` | 压缩后的完整会话 |

会话读取示例：

```json
{
  "id": "session-id",
  "title": "写前端",
  "provider": "default",
  "model": "模型名",
  "history": [
    {
      "messageId": "message-id",
      "role": "user",
      "content": "帮我做一个页面"
    }
  ]
}
```

`history` 中的每条消息都带 `messageId`。回退按钮直接传目标消息的 `messageId`。

运行中的回退会先停止当前 Agent，再执行回退。

### Agent

| 方法 | 地址 | 请求体 | 结果 |
| --- | --- | --- | --- |
| `POST` | `/agent/send/:sessionId` | `{ "input" }` | `{ "ok": true }` |
| `POST` | `/agent/stop/:sessionId` | 无 | `{ "ok": true/false }` |
| `POST` | `/agent/decide/:sessionId` | `{ "callId", "decision" }` | `{ "ok": true/false }` |

`send` 只确认后台任务已启动。模型文字、工具过程和最终结果都通过 SSE 到达。

`decision` 只能是下面三种值：

| 值 | 含义 |
| --- | --- |
| `allow-always` | 始终允许，并把本次参数加入权限规则 |
| `allow-once` | 只允许本次调用，不修改规则 |
| `deny` | 拒绝本次调用 |

同一个会话同时只能运行一个 Agent。再次发送时若收到 `409`，前端应提示用户先停止当前任务。

### SSE

```text
GET /sse/connect/:sessionId
Accept: text/event-stream
```

每条事件的 `data` 是 JSON：

| `type` | 主要字段 | 前端行为 |
| --- | --- | --- |
| `text-delta` | `text` | 追加到当前 assistant 流式文本 |
| `retry` | `attempt`, `error`, `delay` | 显示正在重试 |
| `tool-call` | `toolCallId`, `toolName`, `input` | 创建工具调用卡片 |
| `tool-output` | `tool`, `stream`, `data` | 追加工具实时输出 |
| `tool-result` | `toolCallId`, `toolName`, `output` | 更新工具最终结果 |
| `permission` | `callID`, `tool`, `input` | 显示“始终允许”“允许一次”“拒绝” |
| `compress-delta` | `text` | 显示上下文压缩进度 |
| `finish` | `finishReason`, `usage`, `stop` | 停止流式状态，再刷新会话 |

工具结果 `output` 是 AI SDK 标准结构，常见形式：

```json
{ "type": "text", "value": "普通文本结果" }
```

```json
{ "type": "json", "value": { "exitCode": 0 } }
```

```json
{ "type": "error-text", "value": "工具执行失败：..." }
```

```json
{
  "type": "content",
  "value": [
    { "type": "text", "text": "图片已读取" },
    {
      "type": "file",
      "data": { "type": "data", "data": "base64 数据" },
      "mediaType": "image/png"
    }
  ]
}
```

审批示例：

```js
await fetch(`/agent/decide/${sessionId}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    callId: permission.callID,
    decision: 'allow-once'
  })
})
```

## 推荐前端状态

```js
const state = {
  session: null,
  history: [],
  running: false,
  pendingApproval: null,
  streamMessage: null,
  sseController: null
}
```

关键规则：

```text
收到 text-delta：只追加到 streamMessage
收到 tool-call：创建工具卡片
收到 tool-output：追加到工具卡片
收到 tool-result：更新工具卡片
收到 finish：重新 GET Session.read
断线重连：先重新 GET Session.read，再重新连接 SSE
```

运行错误不会伪装成循环完成，也不会由 `agent.js` 发送 `error` SSE。前端应根据连接状态和请求结果显示错误，并在需要时重新读取会话。

## 部署注意事项

浏览器直接访问独立前端地址、后端在另一个端口时，浏览器会要求后端提供 CORS 响应头。当前后端没有单独配置 CORS。

推荐部署方式是让前端静态文件和后端使用同一个域名和端口，或在反向代理中转发：

```text
https://agent.example.com/              → 前端静态文件
https://agent.example.com/session/...   → 后端
https://agent.example.com/agent/...     → 后端
https://agent.example.com/sse/...       → 后端
```

反向代理必须关闭 SSE 缓冲，并允许长连接。

## 前端生成文件

真实 Agent 生成并验收过一份前端示例，当前保留在：

```text
C:\Users\17137\AppData\Local\Temp\opencode\agent-final-frontend\frontend
```

它不是后端仓库的一部分。可作为对接示例查看。
