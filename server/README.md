# 前端对接文档

这个目录是 Agent 后端。前端只需要通过 HTTP 和 SSE 对接，不需要读取后端源码。

## 后端代码怎么组织

后端遵循 HOP（面向人类编程）规则。任何一次请求都可以沿着下面的主线阅读：

```text
触发事件 → commands 指令执行 → store/features 修改或读取数据 → HTTP/SSE 效果反馈
```

目录职责固定如下：

| 位置 | 只负责什么 | 不负责什么 |
| --- | --- | --- |
| `commands/` | 完成一个清晰的业务动作 | 不处理路由细节 |
| `features/` | 实现可独立理解的业务规则：历史、工具审批、忽略规则、文件快照、工作区 | 不返回 HTTP 响应 |
| `store.js` | 保存内存中的数据结构（配置、会话历史、Agent 实例、快照清单、待审批） | 不判断业务规则、不读 HTTP |
| `tools/` | 内置工具，一个文件放一类动作 | 不修改会话状态 |
| `utils/` | 路径、SSE、带状态码的错误等通用能力 | 不组合业务流程 |

Agent 循环本身不在这里，它来自 `@kernel4632/agent-core`（[仓库](https://github.com/kernel4632/agent-core)）：

- 模型请求、工具执行、上下文压缩都由这个包负责
- `commands/session.js` 只做三件事：把会话配置交给 Agent、把 Agent 的过程转成 SSE、把新消息写回历史文件
- 历史文件里的消息形状就是这个包的标准形状（`id`、`role`、`content` 块数组）

加一个内置工具：往 `tools/` 放一个导出 `{ name, description, inputSchema, execute }` 的文件即可，重启后生效；删掉文件这个工具就消失。
用户自己的工具放在数据目录的 `tools/` 里，同名时覆盖内置工具；`tools/truncate.js` 是共享代码，没有 `name` 和 `execute`，扫描时会自动跳过。

内置工具一共十二个：

| 工具 | 做什么 |
| --- | --- |
| `file_read` / `file_write` / `file_list` | 读文件（含图片）、写完整文本、列目录 |
| `edit` / `apply_patch` | 改一处唯一片段；`apply_patch` 一次改多个文件，全部校验通过才写盘 |
| `grep` / `glob` | 按正则搜内容、按通配找文件，都会跳过 `node_modules` |
| `shell` | 执行命令，带十分钟超时和输出截断 |
| `todo` | 写下当前任务清单和进度，前端据此显示进度条 |
| `webfetch` | 取网页正文 |
| `finish` / `ask` | 结束任务；向用户提问并暂停 |

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

后端把配置和会话保存在数据目录。开发时建议使用独立目录：

```powershell
$env:AGENT_HOME = "C:\temp\agent-data"
```

如果不设置 `AGENT_HOME`，默认目录是：

```text
%USERPROFILE%\.agent
```

目录里各是什么：

```text
.agent/
  config.json        模型服务、系统提示词、工具权限规则 permission
  .agentignore       额外的不许工具碰的文件规则（可选，写法同 .gitignore）
  sessions/<id>/
    meta.json        标题、供应商、模型、时间
    history.json     对话历史，一条消息一个 messageId
    checkpoints.json 每个消息点改了哪些文件
    snapshots/       改文件之前的原样副本，回退时用来恢复
  tools/             用户自己写的工具，和内置工具一起扫描
```

`.agentignore` 里写一条就多拦一类文件，写法同 `.gitignore`，例如：

```text
secrets/
*.local.json
assets/big-*.bin
```

`.env`、`*.pem`、`*.key`、`**/.ssh/**`、`**/.agent/**` 这些内置规则永远生效，改配置也关不掉，
避免密钥或 agent 自己的数据被工具读进对话。

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
    "system": "你是一个编程 Agent。"
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
| `400` | 请求参数不正确，比如标题为空、服务商不存在、审批决定不认识 |
| `404` | 会话不存在，或要回退的消息不在这个会话里 |
| `409` | 该会话已有 Agent 正在运行 |
| `500` | 后端执行失败 |

### 服务状态与工作区

| 方法 | 地址 | 结果 |
| --- | --- | --- |
| `GET` | `/health` | `{ "ok": true, "version": "0.3.0", "sessions": 2, "running": 1 }` |
| `GET` | `/workspace/read` | 当前工作区：路径、文件列表（最多 200 个、不含依赖目录）、git 状态 |
| `GET` | `/workspace/status?path=...` | 只看某个目录的 git 状态 |

前端启动时先打 `/health`，能拿到 `version` 就说明后端在；拿不到就是连不上，可以直接提示用户。

`/workspace/read` 的返回：

```json
{
  "path": "D:/projects/app",
  "files": ["src/main.js", "package.json"],
  "git": { "branch": "main", "changed": 3, "modified": 2, "added": 0, "deleted": 0, "untracked": 1 }
}
```

不是 git 仓库时 `git` 是 `null`，前端据此决定要不要显示分支。

### 配置

| 方法 | 地址 | 请求体 | 结果 |
| --- | --- | --- | --- |
| `GET` | `/config/read` | 无 | 当前完整配置 |
| `PATCH` | `/config/set` | 完整新配置 | 保存后的完整配置 |

`PATCH /config/set` 是整体替换，不是局部合并。

配置里的 `permission` 字段就是工具权限规则，规则为空（`{}`）时所有工具都会先问用户。

> 注意：当前后端会返回完整配置，其中可能含有 `apiKey`。前端展示配置时必须遮蔽密钥，不能直接显示或写入日志。

### 会话

| 方法 | 地址 | 请求体 | 结果 |
| --- | --- | --- | --- |
| `POST` | `/session/create` | `{ "title", "workspaceId?", "provider?", "model?" }` | `{ "sessionId" }` |
| `GET` | `/session/read/:sessionId` | 无 | 会话元信息和完整 History |
| `PATCH` | `/session/rename/:sessionId` | `{ "title" }` | 更新后的会话元信息 |
| `DELETE` | `/session/remove/:sessionId` | 无 | `{ "ok": true }` |
| `POST` | `/session/rollback/:sessionId` | `{ "messageId" }` | 回退后的完整会话，另带 `restored` 是被恢复的文件列表 |
| `POST` | `/session/redo/:sessionId` | 无 | 恢复后的完整会话 |
| `POST` | `/session/compact/:sessionId` | 无 | 压缩后的完整会话，另带 `content` 是这次的总结文本 |

`POST /session/rollback/:sessionId` 会同时回退两样东西：对话消息，以及 agent 改过的文件。
`restored` 列出被恢复的文件路径，前端可以在界面上显示"已把 3 个文件恢复到这一步之前"。
这个能力靠 `features/snapshot.js` 实现：工具改文件之前先按内容存一份原样副本，
所以同一个文件被反复改也只多存一份内容。

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
      "id": "block-id",
      "role": "user",
      "content": "帮我做一个页面"
    }
  ]
}
```

`history` 中的每条消息都带 `messageId`（后端记录用的身份）和 `id`（消息块自己的身份）。回退按钮直接传目标消息的 `messageId`。

助手的 `content` 是内容块数组，可能同时包含思考块和文字块：

```json
{
  "messageId": "message-id",
  "id": "block-id",
  "role": "assistant",
  "content": [
    { "type": "reasoning", "text": "先看看目录结构" },
    { "type": "text", "text": "我来处理。" },
    { "type": "tool-call", "toolCallId": "call-1", "toolName": "file_read", "input": { "path": "a.txt" } }
  ]
}
```

工具结果是一条独立的 `role: "tool"` 消息：

```json
{
  "role": "tool",
  "content": [
    { "type": "tool-result", "toolCallId": "call-1", "toolName": "file_read", "output": { "type": "text", "value": "文件内容" } }
  ]
}
```

运行中的回退会先停止当前 Agent，再执行回退。

### Agent

| 方法 | 地址 | 请求体 | 结果 |
| --- | --- | --- | --- |
| `POST` | `/agent/send/:sessionId` | `{ "input" }` | `{ "ok": true }` |
| `POST` | `/agent/stop/:sessionId` | 无 | `{ "ok": true/false }` |
| `POST` | `/agent/decide/:sessionId` | `{ "toolCallId", "decision" }` | `{ "ok": true/false }` |

`send` 只确认后台任务已启动。模型文字、工具过程和最终结果都通过 SSE 到达。

`decision` 只能是下面三种值：

| 值 | 含义 |
| --- | --- |
| `allow-always` | 始终允许，并把本次参数加入权限规则（写回配置文件） |
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
| `reasoning-delta` | `text` | 追加到当前 assistant 思考文本 |
| `retry` | `attempt`, `error`, `delay` | 显示正在重试 |
| `llm-start` | `messages`, `tools` | 显示正在请求模型 |
| `llm-finish` | `text`, `toolCalls`, `finishReason`, `usage` | 统计本轮模型请求并读取完整结果 |
| `tool-call` | `toolCallId`, `toolName`, `input` | 创建工具调用卡片 |
| `tool-output` | `toolName`, `stream`, `data` | 追加工具实时输出 |
| `tool-result` | `toolCallId`, `toolName`, `output` | 更新工具最终结果 |
| `permission` | `callID`, `tool`, `input` | 显示"始终允许""允许一次""拒绝" |
| `compact-start` / `compact-finish` | 无 / `text` | 显示上下文压缩进度 |
| `agent-start` | 无 | 标记 Agent 任务开始 |
| `agent-finish` | `reason`, `usage`, `text`（失败时是 `error`） | 标记 Agent 任务结束，再刷新会话 |

`tool-output` 里 `stream` 是 `stdout` 或 `stderr`，`data` 是这段原始输出，前端按字符串拼接即可。

`permission` 的 `callID` 就是 `agent/decide` 要传的 `toolCallId`：

```js
await fetch(`/agent/decide/${sessionId}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ toolCallId: permission.callID, decision: 'allow-once' })
})
```

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
{ "type": "execution-denied", "reason": "工具执行被用户拒绝" }
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
收到 agent-start：重新 GET Session.read，只保留到本轮用户消息为止，再新建流式气泡
收到 text-delta：只追加到 streamMessage
收到 tool-call：创建工具卡片
收到 tool-output：追加到工具卡片
收到 tool-result：更新工具卡片
收到 agent-finish：重新 GET Session.read
断线重连：先重新 GET Session.read，再重新连接 SSE
```

任务失败不会伪装成正常结束，后端会发一条带 `error` 字段的 `agent-finish`，前端展示它并重新读取会话。

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

## 接口文档

`openapi.json` 是每个接口的详细说明（参数、响应、错误），改接口时记得一起改。
