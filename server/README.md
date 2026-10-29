# 前端对接文档

这个目录是 Agent 后端。前端只需要通过 HTTP 和 SSE 对接，不需要读取后端源码。

## 后端代码怎么组织

后端遵循 HOP（面向人类编程）规则。一次请求的路径固定是：

```text
HTTP/SSE → server.js → commands/* → features/* → store.js / utils/
                                      └─ features/tool.js → tools/*
```

| 位置 | 只负责什么 |
| --- | --- |
| `server.js` | 注册路由、统一错误、健康检查、启动 |
| `store.js` | 全局数据中心：`config` 和 `sessions` 两个纯对象 |
| `commands/` | HTTP 动作和运行编排，一个文件一组：`session.js`、`chat.js`、`settings.js`；命令文件之间不互相 import |
| `features/` | 独立业务模块：历史、回退、Agent、审批、上下文、压缩、标题、工具登记、MCP；feature 文件之间不互相 import |
| `utils/` | `fail.js`、`path.js`、`sse.js` |
| `tools/` | 按类别分组的工具，一个文件一组；只依赖 `store.js`、`utils/` 和运行时 context |

根目录不放业务代码。加一类工具只往 `tools/` 放一个文件，删掉就消失；加一条会话动作只改 `commands/session.js`。

Agent 循环来自 `@kernel4632/agent-core`（[仓库](https://github.com/kernel4632/agent-core)）：模型请求、工具执行、上下文压缩由这个包完成。

## 五个核心概念

1. **会话**：唯一的长期容器。标题、当前目录 `cwd`、模型、历史、设置都在会话里。
2. **当前目录**：只是会话的一个属性，没有边界。用户可以通过 `PATCH /session/cwd/{sessionId}` 改，agent 可以用 `cwd` 工具自己改。
3. **运行**：从发送消息开始，到结束或停止为止；过程通过 SSE 推送。
4. **工具**：agent 改变外部世界的唯一方式，按类别放在 `tools/`。
5. **扩展**：MCP、技能、子智能体、自动标题都是基座能力。

## 数据目录

数据目录由 `AGENT_HOME` 指定，默认 `%USERPROFILE%\.agent`：

```text
.agent/
  config.json          模型服务、按任务的默认模型、MCP、权限、提示词、压缩阈值
  sessions/<id>/
    meta.json          标题、当前目录、模型、时间
    history.json       消息和回退栈
    settings.json      思考强度
    checkpoints.json   每次改文件的工具调用对应哪些快照
    snapshots/         改文件之前的原样副本
  tools/               用户自己写的工具，和内置工具一起扫描
```

默认情况下全局技能在 `%USERPROFILE%\.agents\skills`，不在数据目录里；测试或容器里把 `AGENT_HOME` 指到临时目录时，全局技能跟着放到 `<AGENT_HOME>/skills`，不会碰真实用户数据。项目技能放在会话当前目录的 `.agent/skills`，同名时项目版覆盖全局版。

## 配置

`PATCH /config/set` 是整体替换，不是局部合并。最小配置：

```json
{
  "prompt": { "system": "你是一个通用 Agent。" },
  "providers": [
    {
      "name": "default",
      "baseURL": "https://example.com/v1",
      "apiKey": "你的密钥",
      "models": [
        {
          "id": "your-model",
          "name": "Your Model",
          "context": 128000,
          "capabilities": ["text", "tools", "image"]
        }
      ]
    }
  ],
  "models": {
    "chat": { "provider": "default", "model": "your-model" },
    "compact": { "provider": "", "model": "" },
    "title": { "provider": "", "model": "" },
    "task": { "provider": "", "model": "" }
  },
  "permission": { "*": "ask" }
}
```

- 每个模型自己带 `context` 和 `capabilities`，没有全局能力表。
- `models` 按任务分开：`chat` 是会话默认模型；`compact`、`title`、`task` 不填就回退到 `chat`。
- 配置只认当前形状；旧字段不迁移，直接忽略。
- `prompt.seeded` 表示默认提示词已经填过一次；用户保存空字符串后不会被重新填回。

### 权限规则

`permission` 的每条规则只有三种动作：

| 动作 | 结果 |
| --- | --- |
| `"allow"` | 直接执行 |
| `"ask"` | 停下来等用户点允许或拒绝 |
| `"deny"` | 直接拒绝，不执行，也不登记审批 |

可以按工具名写，也可以按参数写。参数规则按顺序匹配，最后一条命中的说了算：

```json
{
  "permission": {
    "*": "ask",
    "execute_command": {
      "*": "ask",
      "bun test *": "allow",
      "rm *": "deny"
    }
  }
}
```

`deny` 是硬规则，写错的动作按 `ask` 处理。`update_todo_list`、`attempt_completion`、`ask_followup_question` 是控制循环用的内部工具，不受 `deny` 影响。

### 自动标题

自动标题是默认行为，没有开关。第一次成功聊完，后端用 `models.title` 起一个短标题；起不出来就用用户第一句话的前 12 个字。用户手动改过标题就不再覆盖。标题通过 SSE 的 `title` 事件推给界面。

### 压缩

上下文用到 `config.compact.threshold`（默认 0.8）时自动压缩。手动压缩走 `POST /session/compact/{sessionId}`。压缩模型可以用 `models.compact` 单独配置；它只换连接，上下文预算仍按主模型算。

## 工具

| 文件 | 工具 |
| --- | --- |
| `tools/file.js` | `read_file`、`write_to_file`、`list_files`、`glob`、`search_files`、`edit`、`apply_patch`，以及文件快照和恢复 |
| `tools/shell.js` | `execute_command` |
| `tools/web.js` | `webfetch` |
| `tools/todo.js` | `update_todo_list` |
| `tools/control.js` | `attempt_completion`、`ask_followup_question` |
| `tools/subagent.js` | `new_task` |
| `tools/cwd.js` | `cwd` |
| `tools/skill.js` | `skill` |

每个工具文件导出工具对象或数组，对象里有 `name`、`kind`、`description`、`inputSchema`、`execute` 就会被扫描到。会改文件的工具带自己的快照钩子；命令工具不做文件快照。

**敏感文件由文件工具自己判断。** `.env`、`*.pem`、`*.key`、`.ssh`、agent 自己的 `.agent` 数据目录等永远不交给模型，配置关不掉。命令工具本身能做的事由权限规则管。

### MCP

配置 `mcp` 字段，一个服务一项：

```json
{
  "mcp": {
    "everything": {
      "command": "bun",
      "args": ["node_modules/@modelcontextprotocol/server-everything/dist/index.js"],
      "env": { "SOME_KEY": "值" },
      "enabled": true
    },
    "remote": { "transport": "sse", "url": "https://example.com/sse" },
    "remote-http": { "transport": "http", "url": "https://example.com/mcp" }
  }
}
```

工具名会带服务名前缀，例如 `everything_echo`；两个服务撞名时不会互相覆盖。一个服务连不上只跳过它，并通过 SSE 的 `mcp-error` 告诉前端。

### 技能

每个技能一个文件夹，里面一份 `SKILL.md`：

```text
skills/review/
  SKILL.md
```

```markdown
---
name: review
description: 审查改动时用这个
---
第一步：读 diff。
第二步：……
```

模型平时只看到技能清单，正文在调用 `skill` 工具时才读取。格式不对的文件直接跳过；一个技能都没有时 `skill` 工具不出现。

### 子智能体

`new_task` 把一件独立的探索工作交给子 agent，子 agent 有自己的历史，只把结论交回来。它复用同一套工具和同一个审批关口，还能再往下委托一层，最多两层。主任务被停止时子任务一起停。

## 从零启动

### 1. 安装 Bun

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

重新打开终端后确认：

```powershell
bun --version
```

### 2. 安装依赖

```powershell
cd server
bun install
```

### 3. 选择数据目录

```powershell
$env:AGENT_HOME = "C:\temp\agent-data"
```

不设置时默认是 `%USERPROFILE%\.agent`。

### 4. 创建模型配置

```powershell
New-Item -ItemType Directory -Force "C:\temp\agent-data"
notepad "C:\temp\agent-data\config.json"
```

填入“配置”一节里的最小配置，把供应商、密钥、模型名换成自己的。

### 5. 启动

```powershell
bun start
```

默认地址是 `http://localhost:3000`。浏览器打开 `http://localhost:3000/config/read` 能返回 JSON 就说明后端已启动。

## 前端打开会话

固定顺序：

```text
1. GET  /session/read/:sessionId
2. 用返回的完整 history 渲染页面
3. GET  /sse/connect/:sessionId
4. 接收仍在运行的流式事件
```

不要让 SSE 负责发送完整 history。断线时重新读一次会话，再重新连接 SSE；不要发送 `Last-Event-ID`，后端会从当前缓存的第一条事件开始重放。

## HTTP 接口

所有 JSON 请求使用 `Content-Type: application/json`。错误响应统一是 `{ "error": "错误说明" }`。

| 状态码 | 含义 |
| --- | --- |
| `400` | 请求参数不正确，比如标题为空、目录不存在、供应商不存在、审批决定不认识 |
| `404` | 会话、消息、技能或工具调用不存在 |
| `409` | 会话已有任务在运行，或继续位置不对 |
| `500` | 后端执行失败 |

### 服务状态

| 方法 | 地址 | 结果 |
| --- | --- | --- |
| `GET` | `/health` | `{ "ok": true, "version": "x.y.z", "sessions": 2, "running": 1 }` |

### 配置

| 方法 | 地址 | 结果 |
| --- | --- | --- |
| `GET` | `/config/read` | 当前完整配置 |
| `GET` | `/config/meta` | 按任务的模型标签：`models` |
| `PATCH` | `/config/set` | 保存后的完整配置 |
| `POST` | `/config/test` | `{ provider?, model? }`，真实请求一次模型 |

### 工具

| 方法 | 地址 | 结果 |
| --- | --- | --- |
| `GET` | `/tool/list` | 工具名、类别、权限动作、`configurable`、工具自带的 `ui` |
| `GET` | `/tool/kinds` | 工具类别：`kind`、`label`、`hint` |

### 会话

| 方法 | 地址 | 请求体 | 结果 |
| --- | --- | --- | --- |
| `GET` | `/session/list?search=` | 无 | 磁盘上全部会话的元信息，最近用过的排前面 |
| `POST` | `/session/create` | `{ "title", "cwd?", "provider?", "model?" }` | `{ "sessionId" }` |
| `POST` | `/session/fork/:sessionId` | `{ "title?", "messageId?" }` | `{ "sessionId" }`，复制历史和设置；不复制文件快照 |
| `GET` | `/session/read/:sessionId` | 无 | 会话资料、完整 history、`todos`、`running`、`pending`、`settings`、`undoable` |
| `PATCH` | `/session/rename/:sessionId` | `{ "title" }` | 更新后的会话资料 |
| `POST` | `/session/title/:sessionId` | 无 | 按后续对话重新生成标题：`{ "title" }` |
| `PATCH` | `/session/model/:sessionId` | `{ "provider?", "model?" }` | 更新后的会话资料；运行中返回 `409` |
| `PATCH` | `/session/cwd/:sessionId` | `{ "cwd" }` | `{ "id", "cwd" }`；目录不存在返回 `400` |
| `DELETE` | `/session/remove/:sessionId` | 无 | `{ "ok": true }` |
| `GET` | `/session/settings/:sessionId` | 无 | 思考强度 |
| `PATCH` | `/session/settings/:sessionId` | `{ "reasoning"? }` | 保存后的完整设置 |
| `POST` | `/session/compact/:sessionId` | 无 | 压缩后的完整会话，另带 `content` |

会话读取示例：

```json
{
  "id": "session-id",
  "title": "写前端",
  "cwd": "D:/notes",
  "provider": "default",
  "model": "模型名",
  "running": false,
  "pending": [],
  "todos": [{ "text": "读现有实现", "status": "completed" }],
  "history": [
    {
      "messageId": "message-id",
      "id": "block-id",
      "role": "user",
      "content": "帮我做一个页面"
    }
  ],
  "settings": {
    "reasoning": "auto"
  },
  "undoable": 0
}
```

`pending` 是正在等用户批准的工具调用。审批请求只在 SSE 里出现一次；刷新页面后只有这个字段能告诉界面“有个工具在等你”。

### 运行设置

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `reasoning` | `auto` | `off` / `auto` / `low` / `medium` / `high` / `xhigh` / `max` |

权限只有一层：`config.permission` 的全局规则，加每次询问的“始终允许 / 允许一次 / 拒绝”。没有会话级自动批准，也没有自动批准上限。同一个工具调用连续出现三次时，会停下来让用户确认一次。

模型能不能看图、能不能调用工具，只从 `providers[].models[].capabilities` 读取，不在会话里另存一份。

### 回退与文件快照

消息回退只改对话；文件恢复是文件工具的快照能力。接口允许分开做：

| 方法 | 地址 | 请求体 | 结果 |
| --- | --- | --- | --- |
| `POST` | `/session/rollback/preview/:sessionId` | `{ "messageId" }` | `{ "messages": 4, "files": [...] }` |
| `POST` | `/session/rollback/:sessionId` | `{ "messageId", "files?" }` | 回退后的完整会话，另带 `restored` |
| `POST` | `/session/rollback/tool/:sessionId` | `{ "toolCallId", "files?" }` | 只退某次工具调用改的文件，另带 `restored` |
| `POST` | `/session/redo/:sessionId` | `{ "files?" }` | 撤销最近一次回退，另带 `restored` |
| `GET` | `/session/changes/:sessionId` | 无 | agent 改过的文件：`path`、`before`、`after`、`added`、`deleted` |
| `GET` | `/session/tools/:sessionId` | 无 | 每次改过文件的工具调用，用来列出可回退的点 |

`files` 传 `false` 只退对话，不动磁盘。文件快照按工具调用分组，同一份内容只备份一次；它只由文件工具自己维护。

### Agent

| 方法 | 地址 | 请求体 | 结果 |
| --- | --- | --- | --- |
| `POST` | `/agent/send/:sessionId` | `{ "input" }` | `{ "ok": true }`，过程走 SSE |
| `POST` | `/agent/resume/:sessionId` | 无 | `{ "ok": true }`，继续被中断的助手 |
| `POST` | `/agent/stop/:sessionId` | 可选 `{ "partial" }` | `{ "ok": true/false }` |
| `POST` | `/agent/decide/:sessionId` | `{ "toolCallId", "decision" }` | `{ "ok": true/false }` |

`decision` 只能是：

| 值 | 含义 |
| --- | --- |
| `allow-once` | 只允许本次调用 |
| `allow-always` | 允许本次，并把这类操作写进权限规则 |
| `deny` | 拒绝本次调用 |

`allow-always` 记住的是“用户心里那个操作”：命令类工具按命令前缀记，其他工具按完整参数记。

### SSE

```text
GET /sse/connect/:sessionId
Accept: text/event-stream
```

每条事件的 `data` 是 JSON：

| `type` | 主要字段 | 前端行为 |
| --- | --- | --- |
| `text-delta` | `text` | 追加到当前 assistant 文本 |
| `reasoning-delta` | `text` | 追加到当前 assistant 思考文本 |
| `retry` | `attempt`, `error`, `delay` | 显示正在重试 |
| `llm-start` | `messages`, `tools` | 显示正在请求模型 |
| `llm-finish` | `text`, `toolCalls`, `finishReason`, `usage`, `durationMs` | 统计本轮模型请求 |
| `tool-call` | `toolCallId`, `toolName`, `input` | 创建工具卡片 |
| `tool-output` | `toolName`, `stream`, `data` | 追加工具实时输出 |
| `tool-result` | `toolCallId`, `toolName`, `output` | 更新工具最终结果 |
| `permission` | `callID`, `tool`, `input` | 显示“始终允许 / 允许一次 / 拒绝” |
| `permission-blocked` | `callID`, `tool`, `input`, `reason` | 被权限规则拒绝，不用等用户决定 |
| `permission-limit` | `limit`, `reason` | 同一个调用连续三次，接下来要确认一次 |
| `subagent-tool` | `taskId`, `description`, `toolName`, `input` | 子任务正在用工具 |
| `subagent-tool-result` | `taskId`, `description`, `toolName`, `output` | 子任务的工具跑完了 |
| `mcp-error` | `server`, `error` | 某个 MCP 服务没连上，只是跳过 |
| `compact-start` / `compact-finish` | 无 / `text` | 上下文压缩进度 |
| `title` | `title` | 后端起好了标题 |
| `agent-start` | 无 | 任务开始 |
| `agent-resume` | 无 | 继续任务开始 |
| `agent-finish` | `reason`, `usage`, `text`；失败时 `error` | 任务结束，前端重新读取会话 |

工具结果 `output` 是 AI SDK 标准结构：`text`、`json`、`error-text`、`execution-denied`、`content`。用户主动停止只发一条 `agent-finish`，`reason` 是 `stopped`。

## 部署注意事项

前端和后端不在同一个域名或端口时，浏览器会要求 CORS 响应头；当前后端没有单独配置 CORS。推荐让前端静态文件和后端使用同一个域名和端口，或在反向代理中转发 `/session`、`/agent`、`/sse`、`/config`、`/tool`。反向代理必须关闭 SSE 缓冲，并允许长连接。

## 接口文档

`openapi.json` 是每个接口的详细说明（参数、响应、错误），改接口时记得一起改。
