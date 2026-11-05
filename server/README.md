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
| `commands/` | HTTP 动作和运行编排，一个文件一组：`session.js`、`chat.js`、`settings.js`、`capabilities.js`；命令文件之间不互相 import，有状态 feature 需要的兄弟服务由 `server.js` 在启动时接起来 |
| `features/` | 独立业务模块：历史、回退、Agent、审批、上下文、压缩、标题、工具登记、MCP、本机识别（discover）、技能管理（skills）；feature 文件之间不互相 import |
| `utils/` | `fail.js`、`path.js`、`sse.js`、`skills.js`（技能扫描与启停状态，只读写技能文件，不碰业务配置） |
| `tools/` | 按类别分组的工具，一个文件一组；只依赖 `store.js`、`utils/` 和运行时 context |

根目录不放业务代码。加一类工具只往 `tools/` 放一个文件，删掉就消失；加一条会话动作只改 `commands/session.js`。

Agent 循环来自 `@kernel4632/agent-core` **0.30.4**（[仓库](https://github.com/kernel4632/agent-core)）：模型请求、工具执行、上下文压缩由这个包完成。只按该版本契约接入，不保留旧版适配。继续任务直接调用 `agent.resume()`，不再插入并删除用户占位消息。

0.30 起不再有 `maxSteps` / `step-limit`，循环轮数不设上限；运行中修改 `agent.config`（模型、思考强度、system、工具表）会在下一笔请求生效。`PATCH /session/model/:sessionId` 和保存思考强度不再要求任务空闲。

模型没有调用任何工具时，最多追问 3 轮再结束；默认提示词要求每轮用 `attempt_completion` 收尾，追问时会再提醒一次。这样模型漏调结束工具时，不会把普通文字直接当成结果。

## 重启恢复

任务运行中后端被重启或崩溃时，进程里的运行状态全部丢失；磁盘 `meta.json` 上的 `running: true` 是“这个会话被打断了”的唯一线索。机制：

- 任务开跑前把 `running: true` 写进 meta，收尾（成功、失败、被停止）后清掉；
- 服务启动时扫描全部会话，对所有还带着 `running: true` 的会话逐条处理：
  - 历史末尾是助手回复（包括悬着没有结果的工具调用）→ 直接 `Chat.resume` 自动续跑，过程和手动发送一样走 SSE；
  - 历史末尾是用户消息 → 只清标记，等用户自己发下一句；
  - 尾部 tool 消息里已经有 `attempt_completion` / `ask_followup_question` 的结果 → 任务其实已正常收尾，只清标记；
- 恢复异步进行，不挡启动；单条会话失败（比如供应商配置丢了）只记日志并清标记，不影响其他会话和服务启动。
- 恢复路径的重试有上限（总时长 2 分钟、3 次封顶）：provider 挂了或密钥过期时，无限重试会变成一个永不结束、永不清标记的空转任务，每次重启又续一次。用户自己发消息仍走 core 默认的无限重试，不因慢供应商而失败。

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
    meta.json          标题、当前目录、模型、时间；任务运行中会临时多出 running: true
    history.json       消息和回退栈
    settings.json      思考强度
    tool-timings.json  工具开始/结束时间，刷新后恢复计时
    checkpoints.json   每次改文件的工具调用对应哪些快照
    snapshots/         改文件之前的原样副本
  tools/               用户自己写的工具，和内置工具一起扫描
  skills.json          启用了哪些外部技能目录、单独禁用了哪些技能
  cache/models-dev.json  models.dev 模型目录缓存
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
          "family": "openai",
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

- 每个模型自己带 `context` 和 `capabilities`，没有全局能力表。`family` 可选，只用于模型图标；留空时由 models.dev 目录和模型 ID 自动判断，歧义时不猜。
- `models` 按任务分开：`chat` 是会话默认模型；`compact`、`title`、`task` 不填就回退到 `chat`。
- 配置只认当前形状；旧字段不迁移，直接忽略。
- 模型请求失败沿用 agent-core 的重试：取消和上下文超长除外，其余错误无限次指数退避；首次 5 秒，单次退避上限 120 秒，总重试时长不限。
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

### 项目规则

装配会话和每次取 Agent 实例时，后端会读会话当前目录里的 `AGENTS.md`（没有再看 `AGENTS.txt`、`CLAUDE.md`），把内容拼在系统提示词后面发给模型；文件修改后下次装配自动读新版，移动目录后按新目录读。目录里没有规则文件时，系统提示词只有用户配置的那段。规则超过 20000 字符只取前面部分；它不落盘、不进会话历史。

### 自动标题

自动标题是默认行为，没有开关。第一次成功聊完，后端用 `models.title` 起一个短标题；起不出来就用用户第一句话的前 12 个字。用户手动改过标题就不再覆盖。标题通过 SSE 的 `title` 事件推给界面。

### 压缩

上下文用到 `config.compact.threshold`（默认 0.8）时自动压缩。core 0.30.4 的估算把媒体块单独计费：图片每张按固定 token 算，不再让 base64 字符数虚增上下文；压缩触发比例与界面上显示的真实用量一致。手动压缩走 `POST /session/compact/{sessionId}`。压缩模型可以用 `models.compact` 单独配置；它只换连接，上下文预算仍按主模型算。

## 工具

| 文件 | 工具 |
| --- | --- |
| `tools/file.js` | `read_file`、`read_range`（分段读大文件，offset/limit 按行号）、`write_file`、`find_files`、`search_text`、`edit`（一次调用改一个文件），以及文件快照和恢复 |
| `tools/shell.js` | `execute_command`（可选 `timeout` 参数：毫秒数，超时按进程树杀掉并返回 `timedOut: true`，默认 10 分钟） |
| `tools/background.js` | `background`（start/log/stop/list：把命令放进后台跑，日志实时落在数据目录 processes/ 下；后端重启后进程表清空） |
| `tools/test.js` | `test`（跑测试命令并解析：bun test / Playwright 的通过数、失败数和每条失败的文件与名称，未知格式退回原始输出） |
| `tools/web.js` | `webfetch` |
| `tools/todo.js` | `update_todo_list` |
| `tools/control.js` | `attempt_completion`、`ask_followup_question` |
| `tools/subagent.js` | `new_task` |
| `tools/cwd.js` | `cwd` |
| `tools/skill.js` | `skill` |

每个工具文件导出工具对象或数组，对象里有 `name`、`kind`、`description`、`inputSchema`、`execute` 就会被扫描到。会改文件的工具带自己的快照钩子；命令工具不做文件快照。

`attempt_completion` 提交本轮最终回复并等待用户下一条消息，问候、闲聊和直接问答也使用它；不要求先执行任务或调用其他工具。完整回复放入 `result`，中途进度仍走普通助手文本。描述参考 [Roo Code 的结束工具](https://github.com/RooCodeInc/Roo-Code/blob/main/src/core/prompts/tools/native-tools/attempt_completion.ts)，并补全通用聊天场景。缺少必要信息时用 `ask_followup_question` 提问。

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

技能清单由三处合并：本应用全局目录、会话当前目录的项目目录、设置页里启用的外部技能目录。同名时按“外部目录 → 本应用全局 → 项目目录”覆盖；单独禁用的技能不会出现在清单里。

### 识别本机的 MCP 和技能

设置页打开 MCP 或技能页时，后端会扫一遍这台电脑上常见客户端留下的配置。识别只读，不改别人的文件：

| 类型 | 会看的位置 |
| --- | --- |
| MCP | Claude Desktop、Claude Code（含项目级）、Cursor、VS Code、Windsurf、Cline、Roo Code、Continue、Gemini CLI、opencode、Codex（TOML）、Zed、LM Studio，以及当前目录的 `.mcp.json`、`.cursor/mcp.json`、`.vscode/mcp.json` |
| 技能 | 本应用自己的全局和项目目录，以及 Claude Code、Codex、Gemini CLI、opencode、Cursor 的对应目录 |

MCP 识别结果里的 `env` 和 `headers` 只回传键名，值不回传；导入时后端按编号重新读一遍源文件，把完整值写进本应用的配置。同名服务不会覆盖已有配置。技能默认不会自动交给模型，用户在设置页启用整个目录或导入正文后才生效；启用状态保存在 `skills.json`。

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

前端启动只读取 `/session/list`、`/config/read`、`/config/meta`、`/tool/list` 和 `/tool/kinds`。`/workspace/read`、`/agent/list`、`/command/list` 已移除，不用于初始化。配置按上面的当前字段保存；会话设置只有 `reasoning`。真实前后端联调运行 `cd frontend` 后执行 `bun run test:live`，数据使用 `tmp/` 下的独立目录，模型服务使用本机固定回复。

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

### 模型图标

图标不放进仓库：优先取 LobeHub 的彩色 SVG，缺失时回退 models.dev 的单色 SVG；两者都由服务端代理并缓存，新模型或换 logo 不需要前端发版。

| 方法 | 地址 | 参数 | 结果 |
| --- | --- | --- | --- |
| `GET` | `/model/family` | `model` 或 `family` | `{ family, candidates, ambiguous, source }`；多个候选时不自动选择 |
| `GET` | `/model/icon` | `model` 或 `family`；可选 `theme=dark` 把剩余的 currentColor 换成浅色 | SVG；找不到时 404，前端回退通用模型图标 |

### 能力管理

MCP 和技能都可以先从本机识别，再由用户决定启用哪一部分。识别只读，管理只写本应用自己的配置和技能目录。

| 方法 | 地址 | 请求体 / 参数 | 结果 |
| --- | --- | --- | --- |
| `GET` | `/mcp/list?cwd=` | 无 | `{ servers, detected: { sources, servers } }`；识别结果里 `env` / `headers` 只给键名 |
| `POST` | `/mcp/save` | `{ "name", "definition" }` | 保存后的服务；`definition` 是 `transport`、`command`、`args`、`env`、`url`、`headers`、`enabled` |
| `POST` | `/mcp/import` | `{ "ids": ["cursor::github"], "cwd?" }` | `{ imported, skipped }`；跳过原因 `missing` / `exists` |
| `POST` | `/mcp/remove` | `{ "name" }` | `{ "ok": true, "name" }` |
| `PATCH` | `/mcp/toggle` | `{ "name", "enabled" }` | `{ "name", "enabled" }` |
| `POST` | `/mcp/test` | `{ "name" }` | 真实连一次：`{ ok, name, tools }`；失败时 `ok=false` 并带 `error` |
| `GET` | `/skill/list?cwd=` | 无 | `{ skills, roots, state }`；`roots` 带 `exists`、`enabled`、`skillCount` |
| `GET` | `/skill/read?name=&cwd=` | 无 | 技能的完整内容，含 `body` |
| `POST` | `/skill/save` | `{ "name", "description", "body?", "scope?", "cwd?" }` | 保存后的技能；`scope` 是 `global` 或 `project` |
| `POST` | `/skill/remove` | `{ "name", "scope?", "cwd?" }` | `{ "ok": true, "name" }`；外部目录里的技能不能删 |
| `PATCH` | `/skill/toggle` | `{ "name", "enabled", "cwd?" }` | `{ "name", "enabled" }`；只影响模型清单，文件不动 |
| `PATCH` | `/skill/source` | `{ "path", "enabled" }` | `{ "path", "enabled" }`；`path` 必须是存在且有可用技能的绝对路径 |

`/mcp/list` 的 `cwd` 只影响项目级配置（`.mcp.json`、`.cursor/mcp.json`、`.vscode/mcp.json` 和 Claude Code 的项目表）；不填用后端当前目录。`/skill/list` 同理，只影响项目技能目录。

### 会话

| 方法 | 地址 | 请求体 | 结果 |
| --- | --- | --- | --- |
| `GET` | `/session/list?search=` | 无 | 磁盘上全部会话的元信息，最近用过的排前面 |
| `POST` | `/session/create` | `{ "title", "cwd?", "provider?", "model?" }` | `{ "sessionId" }` |
| `POST` | `/session/fork/:sessionId` | `{ "title?", "messageId?" }` | `{ "sessionId" }`，复制历史和设置；不复制文件快照。分支只读，原会话运行中也能分支 |
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
| `POST` | `/session/rollback/preview/:sessionId` | `{ "messageId" }` | `{ "messages": 4, "toolCalls": ["call-1"], "files": [...] }` |
| `POST` | `/session/rollback/:sessionId` | `{ "messageId", "files?" }` | 回退后的完整会话，另带 `restored` |
| `POST` | `/session/rollback/tool/:sessionId` | `{ "toolCallId", "files?" }` | 只退某次工具调用改的文件，另带 `restored` |
| `POST` | `/session/redo/:sessionId` | `{ "files?" }` | 撤销最近一次回退，另带 `restored` |
| `GET` | `/session/changes/:sessionId` | 无 | agent 改过的文件：`path`、`before`、`after`、`added`、`deleted` |
| `GET` | `/session/tools/:sessionId` | 无 | 每次改过文件的工具调用，用来列出可回退的点 |

`files` 传 `false` 只退对话，不动磁盘。回退任何一条消息时，它和它之后的对话都会退掉；预览的 `toolCalls` 是这次会一起回退的工具调用，文件恢复按调用 id 精确匹配，没有调用 id 的旧快照退回按消息归属判断。文件快照按工具调用分组，同一份内容只备份一次；它只由文件工具自己维护。

### Agent

| 方法 | 地址 | 请求体 | 结果 |
| --- | --- | --- | --- |
| `POST` | `/agent/send/:sessionId` | `{ "input" }`；`input` 是字符串，或内容块数组 `{ type: "text" \| "image" }`（图片为 data URL / http(s) URL，base64 上限 8M 字符） | `{ "ok": true }`，过程走 SSE |
| `POST` | `/agent/resume/:sessionId` | 无 | `{ "ok": true }`，继续被中断的助手；服务启动时也会对被打断的会话自动调用 |
| `POST` | `/agent/stop/:sessionId` | 可选 `{ "partial" }` | `{ "ok": true/false }` |
| `POST` | `/agent/decide/:sessionId` | `{ "toolCallId", "decision" }` | `{ "ok": true/false }` |

`decision` 只能是：

| 值 | 含义 |
| --- | --- |
| `allow-once` | 只允许本次调用 |
| `allow-always` | 允许本次，并把这类操作写进权限规则 |
| `deny` | 拒绝本次调用 |

`allow-always` 记住的是“用户心里那个操作”：命令类工具按命令前缀记，其他工具按完整参数记。

图片随用户消息进入 history 常驻；每次请求模型前由配置的 `capabilities` 决定发不发图片块（`mediaFallback: 'strip'`），没开 `image` 能力的模型只看到文字，切换模型后图片仍然完整保留在历史里。base64 图片上限 8M 字符，data URL 与 http(s) URL 都接受。

### SSE

```text
GET /sse/connect/:sessionId
Accept: text/event-stream
```

每条事件的 `data` 是 JSON：

| `type` | 主要字段 | 前端行为 |
| --- | --- | --- |
| `text-delta` | `text`，压缩时 `request: 'compact'` | 仅普通回答追加到 assistant 文本 |
| `reasoning-delta` | `text`，压缩时 `request: 'compact'` | 仅普通回答追加到 assistant 思考文本 |
| `retry` | `attempt`, `error`, `delay` | 显示正在重试 |
| `llm-start` | `messages`, `tools`, `startedAt`, `provider`, `model` | 显示正在请求模型；`startedAt` 是这次请求的真实开始时间，供应商 / 模型用于统计，重连后计时接着走 |
| `llm-first-token` | `firstTokenAt`, `firstTokenMs` | 第一次收到内容增量；用来显示首字时间，重连后也能恢复 |
| `llm-finish` | `text`, `toolCalls`, `finishReason`, `usage`, `durationMs` | 统计本轮模型请求；`usage` 里带 `firstTokenMs`、`durationMs`、输入 / 输出 / 缓存和这次请求的 `provider` / `model` |
| `tool-call` | `toolCallId`, `toolName`, `input` | 创建工具卡片 |
| `tool-output` | `toolName`, `stream`, `data` | 追加工具实时输出 |
| `tool-result` | `toolCallId`, `toolName`, `input`, `output` | 更新工具最终结果；拒绝、取消、无效调用也会结算 |
| `permission` | `callID`, `tool`, `input` | 显示“始终允许 / 允许一次 / 拒绝” |
| `permission-blocked` | `callID`, `tool`, `input`, `reason` | 被权限规则拒绝，不用等用户决定 |
| `permission-limit` | `limit`, `reason` | 同一个调用连续三次，接下来要确认一次 |
| `subagent-tool` | `taskId`, `description`, `toolName`, `input` | 子任务正在用工具 |
| `subagent-tool-result` | `taskId`, `description`, `toolName`, `output` | 子任务的工具跑完了 |
| `mcp-error` | `server`, `error` | 某个 MCP 服务没连上，只是跳过 |
| `compact-start` / `compact-finish` | `messages` + `startedAt` / `content`, `usage`, `durationMs` | 上下文压缩进度；`usage` 已统一成 `input` / `output` / `cacheRead` / `total` |
| `title` | `title` | 后端起好了标题 |
| `agent-start` | 无 | 任务开始 |
| `agent-resume` | 无 | 继续任务开始 |
| `agent-finish` | `reason`, `usage`, `text`；失败时 `error` | 任务结束，前端重新读取会话 |

工具结果 `output` 是 AI SDK 标准结构：`text`、`json`、`error-text`、`execution-denied`、`content`。用户主动停止只发一条 `agent-finish`，`reason` 是 `stopped`。

压缩请求的原生流事件统一带 `request: 'compact'`，必须先分流，不能当成普通回答或停止时的 `partial`。`compact-start` 带 `messages` 和 `startedAt`；`compact-finish.content` 是总结正文，`usage` 已统一成 `input` / `output` / `cacheRead` / `total` / `durationMs`（不再是原始 AI SDK 字段）；`agent-finish.usage` 已包含自动压缩的请求消耗，不要再重复累加。手动压缩调用的是实例 `agent.compact()`，返回的 `content` 仍为字符串；底层 `Agent.compact.run()` 才返回 `{ content, usage }`，二者不混用。

## 部署注意事项

压缩完成后，服务端会把标准化 `usage` 保存到对应的 `compact: true` 历史项（core 中角色为 `user`）。前端统计应同时累计回答与压缩请求，不能把压缩请求的输入 token 当成主模型当前上下文大小。

前端和后端不在同一个域名或端口时，浏览器会要求 CORS 响应头；当前后端没有单独配置 CORS。推荐让前端静态文件和后端使用同一个域名和端口，或在反向代理中转发 `/session`、`/agent`、`/sse`、`/config`、`/tool`。反向代理必须关闭 SSE 缓冲，并允许长连接。

## 接口文档

`openapi.json` 是每个接口的详细说明（参数、响应、错误），改接口时记得一起改。
