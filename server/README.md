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

### 放技能（skills）

技能和工具一样分两处：内置的在 `server/skills/`（跟着代码走），用户自己的在数据目录 `skills/`。
同名时用户版本覆盖内置版本，改内置技能的行为不用去动代码。

一个文件夹放一份 `SKILL.md`，agent 需要时会自己去读：

```text
skills/
  review-pr/
    SKILL.md
```

```markdown
---
name: review-pr
description: 审查一个 PR 时用这个
---

第一步：读 diff。
第二步：……
```

只有开头的 `name` 和 `description` 会一直待在模型眼前，**正文等它真要用了才读**——
技能正文常常几千字，全塞进上下文会把每个会话都撑满，而大部分技能这一次用不上。
所以 agent 的工具表里会出现一个 `skill` 工具，用来按需读正文。

格式不对的文件直接跳过，不会挡住别的技能；目录里一个技能都没有时，这个工具根本不出现。

### 接外部工具服务（MCP）

配置文件的 `mcp` 字段里写一个服务，它给出的工具就会和内置工具一起交给模型：

```json
{
  "mcp": {
    "everything": {
      "command": "bun",
      "args": ["node_modules/@modelcontextprotocol/server-everything/dist/index.js"],
      "env": { "SOME_KEY": "值" },
      "enabled": true
    }
  }
}
```

- 键名是服务名，工具名会带上这个前缀（上面服务里的 `echo` 变成 `everything_echo`），两个服务撞名时不会互相覆盖
- 连上是慢的，所以连过一次就留着；配置里删掉某个服务，下一次建会话时它的连接和工具一起消失
- 某个服务连不上只会跳过它，会话照常创建，失败原因通过 SSE 的 `mcp-error` 事件推给前端

内置工具一共十三个：

| 工具 | 做什么 |
| --- | --- |
| `file_read` / `file_write` / `file_list` | 读文件（含图片）、写完整文本、列目录 |
| `edit` / `apply_patch` | 改一处唯一片段；`apply_patch` 一次改多个文件，全部校验通过才写盘 |
| `grep` / `glob` | 按正则搜内容、按通配找文件，跳过哪些目录由 `utils/skip.js` 一处说了算 |
| `shell` | 执行命令，带十分钟超时和输出截断 |
| `todo` | 写下当前任务清单和进度，前端据此显示进度条 |
| `webfetch` | 取网页正文 |
| `task` | 把一件独立的探索工作委托给子 agent，只拿回结论 |
| `finish` / `ask` | 结束任务；向用户提问并暂停 |

`task` 是唯一一个内存工具（其余都是文件工具）：它需要模型配置和工具表，这两样只有主进程有。
它的用处是**省上下文**——让子 agent 去翻一堆文件，翻的过程全留在子 agent 自己的历史里，
主 agent 只拿到结论，历史干净得像没读过那些文件。子 agent 拿不到 `task` 工具，所以套不下去；
它失败只作为一条结论回来，不会打断主任务；主任务被停止时它一起停。

> **关于联网搜索**：这里没有 `websearch` 工具。搜索需要外部服务的 API Key，本项目不替你选一家；
> 而"不需要 Key 的搜索"要么违反服务条款、要么随时会坏。做一个没配 Key 就必然失败的工具，
> 比没有这个工具更糟——模型会以为它能搜。需要搜索就配一个 MCP 搜索服务（比如 tavily 或
> brave 的 MCP 服务），见上面的「接外部工具服务」。

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
  skills/            技能，一个文件夹一份 SKILL.md，agent 需要时自己读
```

内置工具在 `server/tools/`，内置技能在 `server/skills/`；两处都是同名时用户版本覆盖内置版本。

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
| `GET` | `/health` | `{ "ok": true, "version": "0.10.1", "sessions": 2, "running": 1 }` |
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
| `GET` | `/session/list?search=` | 无 | 磁盘上全部会话的元信息，最近用过的排前面 |
| `POST` | `/session/create` | `{ "title", "workspaceId?", "provider?", "model?" }` | `{ "sessionId" }` |
| `GET` | `/session/read/:sessionId` | 无 | 会话元信息、完整 History、任务清单 `todos`、是否在跑 `running`、待批准 `pending`、运行设置 `settings` |
| `GET` | `/session/changes/:sessionId` | 无 | agent 改过的文件：每个文件改动前后的内容 |
| `GET` | `/session/settings/:sessionId` | 无 | 这条会话的运行设置：模式、自动批准、能力开关 |
| `PATCH` | `/session/settings/:sessionId` | `{ "mode?", "autoApprove?", "capabilities?" }` | 保存后的完整设置 |
| `GET` | `/session/tools/:sessionId` | 无 | 每次改过文件的工具调用，按发生顺序；用来列出可回退的点 |
| `PATCH` | `/session/rename/:sessionId` | `{ "title" }` | 更新后的会话元信息 |
| `DELETE` | `/session/remove/:sessionId` | 无 | `{ "ok": true }` |
| `POST` | `/session/rollback/preview/:sessionId` | `{ "messageId" }` | 这次回退会消失多少消息、恢复哪些文件 |
| `POST` | `/session/rollback/:sessionId` | `{ "messageId", "files?" }` | 回退后的完整会话，另带 `restored` 是被恢复的文件列表 |
| `POST` | `/session/rollback/tool/:sessionId` | `{ "toolCallId", "files?" }` | 只退这一次工具调用改的文件，另带 `restored`；对话不动 |
| `POST` | `/session/redo/:sessionId` | `{ "files?" }` | 撤销回退后的完整会话，另带 `restored` |
| `POST` | `/session/compact/:sessionId` | 无 | 压缩后的完整会话，另带 `content` 是这次的总结文本 |

### 运行设置：模式、自动批准、能力开关

这三项都直接对应 `@kernel4632/agent-core` 的字段，不做二次翻译，设置存在会话目录的 `settings.json` 里。

```json
{
  "mode": "build",
  "autoApprove": { "read": false, "write": false, "command": false, "mcp": false, "subtask": false },
  "autoApproveLimits": { "requests": 50, "cost": 2 },
  "capabilities": { "image": true, "cache": true, "stream": true },
  "uses": {},
  "autoTitle": true
}
```

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `mode` | `build` | `plan` 只给只读工具（读文件、搜代码、抓网页），`build` 给全套工具 |
| `autoApprove.read` | `false` | 读文件和搜索不再弹审批（`file_read`、`file_list`、`glob`、`grep`、`webfetch`、`skill`） |
| `autoApprove.write` | `false` | 改文件不再弹审批（`file_write`、`edit`、`apply_patch`） |
| `autoApprove.command` | `false` | 执行命令不再弹审批（`shell`） |
| `autoApprove.mcp` | `false` | MCP 服务给的工具不再弹审批，按配置里的服务名前缀认 |
| `autoApprove.subtask` | `false` | 开子任务不再弹审批（`task`）。子 agent 自己动文件时仍按上面几类分别判断 |
| `autoApproveLimits.requests` | `50` | 连续自动批准这么多次之后停下来问一句；`0` 表示不设上限 |
| `autoApproveLimits.cost` | `2` | 累计花到这么多之后停下来问一句；`0` 表示不设上限 |
| `capabilities.image` | `true` | 能不能把图片发给模型 |
| `capabilities.cache` | `true` | 提示词缓存 |
| `capabilities.stream` | `true` | 流式输出 |
| `uses` | `{}` | 哪件事用哪个模型，见下节。空＝都用主模型 |
| `autoTitle` | `true` | 第一次聊完让模型起个标题 |

**自动批准按类别分别开关，不是一个总开关。** 可以配成"读随便读、写还是问我"：只把 `read` 设成 `true`，`file_read` 直接过，`file_write` 和 `shell` 照样进等待队列。每一类可以随时单独改，改一类不动别类。

这套开关的类别和界面上的选项对齐 roo code，但只保留我们真有的东西。它那边还有「切换模式」和「追问」两项自动批准：我们没有"由模型自己切换模式"这回事（模式是用户在界面上切的），也没有"到点自动选一个追问答案"的机制，所以不设这两个开关——真加了就是永远不生效的空开关。

PATCH 时只写要改的那一类就行，其余保持原样：

```json
{ "autoApprove": { "read": true } }
```

**认不出类别的工具一律要问。** 用户自己放进数据目录 `tools/` 的工具没有登记类别，即使每一类都开着也仍然弹审批——不能因为"不知道它是什么"就替用户放行。工具分类只写在 [`utils/tool-kind.js`](utils/tool-kind.js:1) 一处，自动批准、plan 模式和契约检查都从那里读；新加内置工具时在表里补一行即可（漏了会有测试报出来）。

**记清单和结束循环不问。** `todo`、`finish`、`ask` 是控制循环用的，既不碰磁盘也不碰外部服务，本来就没有"要不要批准"这回事，所以不设开关。每次都要问一遍的话，用户只会一直点同意，审批弹窗也就没意义了。

**子任务走同一道审批关口。** `task` 建子 agent 时带着同一个审批回调，回到同一条会话。少了它，子任务里的读文件和执行命令完全不问用户，`.agentignore` 也拦不住，而且不报任何错——表现只是"某个密钥文件莫名其妙被读到了"。

**开了自动批准也绕不过 `.agentignore`。** 自动批准省掉的是"问一遍"，密钥文件（`.env`、`*.pem`、`**/.ssh/**` 等）照样读不到，被拦住时会收到 `permission-blocked` 事件，带上是哪条规则挡的。

**`plan` 模式不是靠提示词实现的。** 后端把写工具从工具表里摘掉，模型看不到也调不到，而不是在系统提示词里写"请不要改文件"。这样不依赖模型听话，`system` 也能保持用户原样。

**系统提示词默认是空的**，后端不做任何注入。用户没写 `prompt.system` 时 `config.system` 就是 `""`，模型拿到的是它自己的默认行为。

### 哪件事用哪个模型

总结和起标题不需要主模型那么聪明，用便宜快的小模型就够。所以这三件事可以各配一个模型：

| `uses` 里的键 | 用在哪儿 | 底层是什么 |
| --- | --- | --- |
| `compact` | 上下文压缩时的总结 | agent-core 自带的 `config.compact`，我们只是接出来 |
| `title` | 第一次聊完生成会话标题 | 走 `Agent.llm.chat` 单独问一次 |
| `subtask` | 子 agent 干活时的模型 | 子 agent 的 config |

```json
{ "uses": { "compact": { "provider": "deepseek", "model": "deepseek-chat" } } }
```

**不写就是和主模型共用**，这是绝大多数人的用法——不该逼着用户为每件事都配一遍。PATCH 时只写要点的那一件事，其余保持原样；把某一项传 `null` 表示改回共用。

只写 `provider` 不写 `model` 的那一项会被丢掉，按"没配"处理：半条配置发出去只会变成一次没有模型的请求。

**压缩只换连接那一半。** `system` 和上下文预算仍按主模型算——压缩请求有多大是由主模型的预算决定的，跟压缩模型自己的窗口无关。给压缩模型另配 `maxContextTokens` 会让"压到多大"变成另一套标准，反而更难查。

### 自动生成标题

第一次聊完，后端拿用户的开头几句话让模型起一个短标题（默认 12 个字以内），存在 `meta.json` 的 `title` 里。用户手动改过标题就不再动它；关掉 `autoTitle` 就一直是"新对话"。

起好之后通过 SSE 推一条 `title` 事件，界面不用等下一次刷新。**起标题失败（模型连不上等）只返回 null，不报错**——名字只是顺手的好事，不该影响用户干活。

这一项不用重试：agent-core 默认会一直重试（退避 5s、10s、20s… 不设总时长），那意味着服务挂掉时光给会话起个名字就能拖十几分钟，而这一轮早就结束了。

### 自动批准的刹车

`autoApproveLimits` 是防止"开着自动批准结果跑飞了"的：连续自动批准到 `requests` 次、或者累计花到 `cost`（美元），就停下来问用户一句"要继续吗"。两项都设 `0` 表示不设上限。

这是唯一一处"默认不是最宽松"的地方。已经开了自动批准，再不设上限，跑飞了就是真花钱，所以给一个宽松但有数的档。

改 `mode` 会立刻按新设置重新装配工具表（历史不动），所以要求会话没有任务在跑，否则返回 `409`。

**`autoApprove` 可以在任务跑着的时候随时改。** 审批时是现读设置的，改完下一次工具调用就按新设置走，不用重建 Agent，也不受 `409` 限制——用户看到模型在乱改文件时要能当场把"写入"关掉。`capabilities` 换了要重建 Agent，所以同样要求没有任务在跑。
`GET /session/changes/:sessionId` 给出 agent 到目前为止改动的文件，用来在界面上显示 diff：

```json
[
  {
    "path": "D:/projects/app/src/main.js",
    "before": "旧内容",
    "after": "新内容",
    "added": false,
    "deleted": false
  }
]
```

`added` 为 true 表示这个文件是任务期间新建的（`before` 是空串），`deleted` 为 true 表示被删掉了。
内容没变过的文件不会出现在结果里。这份数据来自文件快照，所以和回退能看到的是同一件事。

### 回退：可以只退对话，也可以连着撤销

**对话和文件是两件可以分开的事。** `files` 传 `false` 就只退对话、不动文件——用户可能想
把对话退回去接着问，也可能想留着对话看 agent 到底改了什么。不传就是两样都退。

回退之前先调 `POST /session/rollback/preview/:sessionId` 看代价，别让用户盲目确认：

```json
{
  "messages": 4,
  "files": [{ "path": "D:/app/src/a.js", "before": "旧", "after": "新", "added": false, "deleted": false }]
}
```

**可以连着回退好几步，再一步步撤销回来。** 每回退一次就压一层；`POST /session/redo` 弹掉
最上面一层（对话和文件一起回去）。发新消息会清空这些层——新消息代表新的时间线，
退回到更早的状态已经没有意义了。

`GET /session/read` 返回的 `undoable` 是还剩几层可以撤销，界面据此决定要不要显示"撤销回退"。

文件能恢复靠 `features/snapshot.js`：工具改文件之前先按内容存一份原样副本，所以同一个文件
被反复改也只多存一份内容。撤销回退时连"回退前是什么样"也存过一份，所以撤销能让文件回到回退前的状态。

`GET /session/list` 是列表接口，不返回历史，只返回元信息：

```json
[
  { "id": "session-id", "title": "写前端", "provider": "default", "model": "模型名", "createdAt": 1724745600000, "updatedAt": 1724745900000 }
]
```

前端启动时用它填充侧边栏；搜索传 `?search=`，按标题和模型名匹配。**会话列表以这个接口为准**，
不要在浏览器本地再存一份，否则换台机器或清掉缓存就找不回来了。

会话读取示例：

```json
{
  "id": "session-id",
  "title": "写前端",
  "provider": "default",
  "model": "模型名",
  "running": false,
  "pending": [{ "callID": "call-1", "tool": "shell", "input": { "command": "rm -rf build" } }],
  "todos": [{ "text": "读现有实现", "status": "completed" }],
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

`todos` 是 agent 最近一次调用 `todo` 工具写下的任务清单，直接从历史里取出来，界面上可以直接渲染进度。
`running` 说明这个会话现在有没有任务在跑。

`pending` 是正在等用户批准的工具调用。审批请求只在 SSE 里出现过一次，**刷新页面或换台设备打开
同一个会话时，只有这个字段能告诉界面"有个工具在等你"**——否则会话看起来就像卡住了。
批准、拒绝或任务被停止后，它自动变空。

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
| `allow-always` | 始终允许，并把这类操作加入权限规则（写回配置文件） |
| `allow-once` | 只允许本次调用，不修改规则 |
| `deny` | 拒绝本次调用 |

`allow-always` 记住的是"用户心里认为的那个操作"，不是这串一模一样的参数：

- 命令类工具记住命令本身，参数不算。允许一次 `git commit -m "第一个提交"`，
  之后 `git commit -m "完全不同的信息"` 也不会再问；但 `git push` 是另一个操作，仍然会问。
- 其他工具记住完整参数，比如"只允许读这一个文件"。

这条规则让审批次数跟"用户实际做了几个决定"对得上，而不是跟"字符串变了多少次"对得上。

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
| `permission-blocked` | `tool`, `input`, `reason` | 这个工具碰到了 `.agentignore` 护着的文件，已被拦下，不用等用户决定 |
| `subagent-tool` | `description`, `toolName`, `input` | 子任务正在用工具，可以显示"正在查 XXX" |
| `subagent-tool-result` | `description`, `toolName`, `output` | 子任务的工具跑完了 |
| `mcp-error` | `server`, `error` | 某个 MCP 服务没连上；只是跳过它，会话照常 |
| `compact-start` / `compact-finish` | 无 / `text` | 显示上下文压缩进度 |
| `title` | `title` | 后端起好了会话标题，更新侧边栏和标签文字，不用等下一次刷新 |
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
