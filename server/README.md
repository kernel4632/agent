macOS 安装、启动与验证见 [macOS 使用说明](../docs/MACOS.md)。默认数据目录为 `~/.agent`，全局技能目录为 `~/.agents/skills`。

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
| `utils/` | 无业务状态的共用小工具：带状态码的错误、数据路径拼接、SSE 服务端、子进程管理、命令分词、上下文用量台账，以及文件与文本的通用判断（`fs.js`、`text.js`）。不依赖任何 feature |
| `tools/` | 按类别分组的工具，一个文件一组；只依赖 `store.js`、`utils/` 和运行时 context |

根目录只放入口和数据文件；脚本类产物（比如文档生成器）放 `scripts/`。加一类工具只往 `tools/` 放一个文件，删掉就消失；加一条会话动作只改 `commands/session.js`。

Agent 循环来自 `@kernel4632/agent-core`（[仓库](https://github.com/kernel4632/agent-core)）：模型请求、工具执行、上下文压缩由这个包完成。实际使用的版本看 `package.json`，这里不重复写——写死的版本号一定会过期。只按当前版本契约接入，不保留旧版适配。继续任务直接调用 `agent.resume()`，不再插入并删除用户占位消息。

循环轮数不设上限（早期版本的 `maxSteps` / `step-limit` 已移除）；运行中修改 `agent.config`（模型、思考强度、system、工具表）会在下一笔请求生效，切模型和保存思考强度不再要求任务空闲。

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
  config-backups/      配置自动备份，保留最近 20 份
  session-groups.json  会话自定义分组、组顺序和组内顺序
  sessions-path.json   自定义会话目录指针（仅在改过会话位置后存在）
  sessions-move.json   等待重启执行的会话迁移（仅迁移期间存在）
  sessions/<id>/       每条会话一个目录；默认位置，也可单独放到其他磁盘
    meta.json          标题、当前目录、模型、时间；任务运行中会临时多出 running: true
    history.jsonl      未发生上下文压缩时的追加式历史
    history-index.json 压缩会话的分段索引：每个 compact 边界、段文件、当前段和压缩摘要
    history/           压缩会话的封存段（segment-XXXX.jsonl）和当前段（current.jsonl）
    history-redo.json  回退撤销栈
    settings.json      思考强度
    tool-timings.json  工具开始/结束时间，刷新后恢复计时
    checkpoints.json   每次改文件的工具调用对应哪些快照
    snapshots/         改文件之前的原样副本
  tools/               用户自己写的工具，和内置工具一起扫描
  skills.json          启用了哪些外部技能目录、单独禁用了哪些技能
  cache/models-dev.json  models.dev 模型目录缓存
```

默认情况下全局技能在 `%USERPROFILE%\.agents\skills`，不在数据目录里；测试或容器里把 `AGENT_HOME` 指到临时目录时，全局技能跟着放到 `<AGENT_HOME>/skills`，不会碰真实用户数据。项目技能放在会话当前目录的 `.agent/skills`，同名时项目版覆盖全局版。

会话历史、文件快照和工具输出占用会持续增长，可通过「设置 → 数据管理 → 会话数据目录」把整个 `sessions/` 单独放到其他磁盘。服务只写入待迁移标记，重启后在加载会话前复制并切换；旧目录保留。启动时也可以用 `AGENT_SESSIONS` 直接指定会话目录，此时界面为只读。

第一次出现 `compact` 消息时，后端会把单体 `history.jsonl` 按压缩边界迁移成 `history-index.json + history/`。`GET /session/open/{sessionId}` 只返回 `historyManifest` 和最后一次压缩之后的当前段；展开历史段时前端调用 `GET /session/segment/{sessionId}/{segmentId}`。`GET /session/read/{sessionId}` 仍然返回完整历史，供 CLI 和旧客户端使用，不受分段影响。

新会话如果没有传 `cwd`，会在系统临时目录的 `agent/` 下创建独立工作区（`session-*`），避免 agent 默认在项目代码旁边动手。删除会话时清理该临时目录；用户在「切换工作区」里换成真实目录后，会话的 `temporary` 变为 `false`，旧临时目录也会被清理。可以用 `AGENT_TMP` 改临时工作区的根目录。

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
          "capabilities": ["text", "tools", "image"],
          "maxOutput": 8192,
          "temperature": 0.3,
          "topP": 0.9,
          "seed": 42,
          "body": { "top_k": 20 }
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
  "compact": { "threshold": 0.8 },
  "contextKeep": { "firstTurns": 3, "recentTurns": 3, "firstShare": 0.2, "recentShare": 0.3 },
  "permission": { "*": "ask" }
}
```

- 每个模型自己带 `context` 和 `capabilities`，没有全局能力表。`family` 可选，只用于模型图标；留空时由 models.dev 目录和模型 ID 自动判断，歧义时不猜。
- `maxOutput`、`temperature`、`topP`、`seed` 是可选生成参数；`maxOutput` 映射到 agent-core 的单次最大输出，其余原样交给 AI SDK。`body` 用来覆盖请求体里没有可视化字段的高级参数，例如 `{ "top_k": 20 }`。
- `models` 按任务分开：`chat` 是会话默认模型；`compact`、`title`、`task` 不填就回退到 `chat`。
- `compact.threshold` 是自动压缩的触发比例。`contextKeep` 决定压缩后还留多少总结之前的原文：`firstTurns` 是开场最多保留几个用户回合（**填 0 就是压缩后不再带上最初那几轮原始对话**，只用总结 + 最近的现场），`recentTurns` 是总结之前最多保留几个回合，两个 `*Share` 分别是这两段最多占多少上下文预算。轮数写 0 就是 0，不会被当成“没填”退回默认值；本次发送的用户输入永远保留。
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

上下文用到 `config.compact.threshold`（默认 0.8）时自动压缩。距压缩点只剩 5% 预算时，core 的 `onInject` 钩子会往下一笔请求临时附一句提醒（不写进历史），让模型本轮收口——阈值从压缩阈值推导（压缩点 - 5% 预算），用户调低压缩阈值时提醒点自动跟着挪；每个 run 只提醒一次。core 0.31.0 的估算把媒体块单独计费：图片每张按固定 token 算，不再让 base64 字符数虚增上下文；压缩触发比例与界面上显示的真实用量一致。手动压缩走 `POST /session/compact/{sessionId}`。压缩模型可以用 `models.compact` 单独配置；它只换连接，上下文预算仍按主模型算。

压缩后的请求由「摘要 + 开场保留的原文 + 最近保留的原文 + 本次输入」拼成，两段原文保留多少轮由 `config.contextKeep` 决定：`firstTurns` 填 0 就只剩摘要和最近的现场，不再带最初那几轮原始对话。改完配置下一次请求就生效，正在跑的会话也会用新值。

## 工具

| 文件 | 工具 |
| --- | --- |
| `tools/file.js` | `read_file`（可传 `offset`/`limit` 按行分段；超过 200000 字符自动分段并给出 `nextOffset`）、`write_file`、`find_files`（`limit` 默认 200）、`search_text`（`limit` 默认 200 行）、`edit`（一次调用改一个文件）、`move_file`、`copy_file`（目标已存在时拒绝，不覆盖；move 的快照同时记录源和目标），以及文件快照和恢复 |
| `tools/shell.js` | `execute_command`（命令按 shell 风格分词：引号内空格是一个参数；不需要 shell 特性时直接起进程，管道/重定向/变量/通配才交给系统 shell。可选 `background: true`：立刻返回进程卡；可选 `timeout`：毫秒数，默认且最大 30000。**前台最多等 30 秒**，到时未结束不会杀进程，而是自动交给后台并返回 `timedOut: true` + 进程 id + 已产生的输出，提示模型继续并行工作，之后用 `background` 的 log 看） |
| `tools/background.js` | `background`（log/stop/kill/list：查看和停止后台进程；`log` 支持 `waitFor` / `waitMs` 等待新输出或特定行，不再靠反复轮询。启动进程只有 `execute_command` 的 `background: true` 一条路） |
| `tools/web.js` | `webfetch` |
| `tools/context.js` | `ctx_usage`（当前上下文用量、压缩点和剩余量；数据来自 `onInject` 每轮上报的真实估算，让模型自己决定何时落盘、何时收口） |
| `tools/todo.js` | `update_todo_list` |
| `tools/control.js` | `attempt_completion`、`ask_followup_question` |
| `tools/history.js` | `history_search`（在本会话历史里按关键词/正则找当时确认过的细节；上下文压缩后用，命中返回 messageId + 片段，默认只搜当前会话） |
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

工具名会带服务名前缀，例如 `everything_echo`；两个服务撞名时不会互相覆盖。

一个服务连不上（命令不存在、握手超时）只跳过它，并通过 SSE 的 `mcp-error` 告诉前端；
失败原因同时会出现在 `GET /mcp/list` 对应服务的 `error` 字段上，设置页能直接看到。
**失败不会改你的配置**：进程内跳过重试（不重复白等 5 秒），但 `enabled` 保持你写的值，
修好命令后重新保存或重启即可重新连上。

服务启动后会在后台预热 MCP 连接；打开、切换会话只读历史，不等待 MCP。这样外部服务超时不会把会话界面卡住，连接失败也不会在切换会话时弹提示。

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

如果只想把占用最大的会话数据放到其他磁盘，启动后可以在「设置 → 数据管理 → 会话数据目录」里选择新目录；迁移在重启后端后执行。也可以直接指定：

```powershell
$env:AGENT_SESSIONS = "D:\AgentSessions"
```

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

## 接口

路由只有一处来源：`server.js` 里的注册语句（路径、方法、Elysia 入参校验都写在那里）。没有单独的接口清单文件，也没有生成步骤。

- 前端测试直接解析 `server.js` 得到路由表（`frontend/tests/server-routes.js`）：mock 后端只回应真实注册过的路径，前端发起的每一次请求都必须在里面。
- `bun test` 里的契约测试盯着需要对齐的东西：健康检查版本 = `package.json`、工具类别、按任务的模型、结束工具名单，以及下面的 SSE 事件表。
- 改接口时改两处：本文档（前端怎么接）和 `frontend/src/utils/api.js`（前端实际发的请求）。

### SSE 事件

`GET /sse/connect/{sessionId}` 推的事件类型：`agent-start`、`agent-resume`、`agent-finish`、`text-delta`、`reasoning-delta`、`retry`、`llm-start`、`llm-first-token`、`llm-finish`、`tool-call`、`tool-output`、`tool-result`、`tool-input-start`、`tool-input-delta`、`tool-input-end`、`permission`、`permission-blocked`、`mcp-error`、`compact-start`、`compact-finish`、`title`。

- `llm-start` 带 `startedAt`（这次请求的真实开始时间）和 `provider` / `model`。
- `llm-first-token` 带 `firstTokenAt` / `firstTokenMs`；`llm-finish.usage` 带首字时间、总耗时、输入 / 输出 / 缓存和这次请求的 `provider` / `model`。
- 压缩请求的原生流事件带 `request=compact`，不能追加到助手正文、思考或停止时的 partial；`compact-start` 带 `messages` 和 `startedAt`，`compact-finish` 带 `content`、`durationMs` 和统一后的 `usage`。
- `agent-finish.usage` 包含自动压缩用量；工具拒绝、取消和无效调用也会发一条 `tool-result`。

## 部署注意事项

压缩完成后，服务端会把标准化 `usage` 保存到对应的 `compact: true` 历史项（core 中角色为 `user`）。前端统计应同时累计回答与压缩请求，不能把压缩请求的输入 token 当成主模型当前上下文大小。

前端和后端不在同一个域名或端口时，浏览器会要求 CORS 响应头；当前后端没有单独配置 CORS。推荐让前端静态文件和后端使用同一个域名和端口，或在反向代理中转发 `/session`、`/agent`、`/sse`、`/config`、`/tool`。反向代理必须关闭 SSE 缓冲，并允许长连接。

