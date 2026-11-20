# Agent

以会话为中心的个人 Agent 软件。用户在一个会话里持续对话；本仓库提供新后端（`backend/`）和新网页（`web/`），以及一组内置扩展。旧的 `server/` 仍留在仓库里，尚未删除。

## 现在有什么

| 部分 | 状态 | 说明 |
| --- | --- | --- |
| `backend/` | 可用（0.2.0） | Bun.serve + agent-core 1.2.1，扩展加载器和内置扩展 |
| `web/` | 可用（0.6.0） | Vue 3 对话页，经 `/api` 连到新后端 |
| `extensions/` | 可用 | 会话、设置、基础工具、权限、技能、任务清单、MCP、自动标题 |
| `server/` | 旧实现，仍保留 | 以前的 Elysia 服务端 |
| 桌面端 | 还没写 | 计划用 Go + Wails，仓库里还没有代码 |

## 功能

- 会话创建、重命名、分支、删除和按后续对话重新生成标题；列表存在服务端，换浏览器或清掉缓存都还在
- 当前目录 `cwd` 只是会话的一个属性：用户可以改，agent 也能用 `cwd` 工具自己移动，换目录不丢历史
- Markdown 消息、思考过程、工具调用和用量展示；代码块高亮与复制、KaTeX 数学公式、mermaid 图表（跟随界面明暗配色）
- 消息回退与撤销回退，**回退时可同时把 agent 改过的文件恢复回去**；也可以只退某一次工具调用改的文件
- 查看 agent 改过哪些文件（改动前后对照）
- 任务清单和执行状态展示
- 工具权限规则：拒绝 / 允许一次 / 始终允许；输入框旁的「工具自动批准」小窗里每个工具自己就是一个开关，一键「全部自动执行」把全局规则设为允许，多行命令同样直接执行，明确拒绝仍然生效。敏感文件（`.env`、私钥、`.ssh`、agent 自己的数据目录）由文件工具自己判断，配置关不掉
- 停止运行中的任务，继续被中断的助手回复
- 内置十二个常驻工具，加上按需出现的技能读取工具、用户自己写的工具、MCP 外部服务和子智能体
- 自动识别本机其他软件留下的 MCP 配置和技能目录；识别只读，用户确认后再导入或启用
- MCP 服务和技能的日常管理：增删改、启停、连接测试、新建和编辑技能正文
- 供应商、模型、系统提示词、工具、MCP、技能、外观与数据设置；对话、压缩、标题、子任务可以分别指定模型

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | Vue 3 + JavaScript |
| 服务端 | Bun + Elysia + [@kernel4632/agent-core](https://github.com/kernel4632/agent-core) |

Agent 循环（模型请求、工具执行、上下文压缩）由独立发布的 `@kernel4632/agent-core` 提供，本项目不再自带实现；这个项目同时也是这个包的一个使用范例。

## 数据目录

默认数据目录在 macOS/Linux 为 `~/.agent`，Windows 为 `%USERPROFILE%\.agent`，可通过 `AGENT_HOME` 修改：

```text
.agent/
  config.json                模型服务、按任务的默认模型、工具权限规则、MCP 服务
  config-backups/            配置自动备份，保留最近 20 份
  session-groups.json        会话自定义分组、组顺序和组内顺序
  sessions-path.json         自定义会话目录指针（仅在改过会话位置后存在）
  sessions-move.json         等待重启执行的会话迁移（仅迁移期间存在）
  sessions/<id>/             每条会话一个目录；默认位置，也可单独放到其他磁盘
    meta.json                标题、当前目录、模型、时间
    history.jsonl            追加式消息历史
    history-redo.json        回退撤销栈
    settings.json            思考强度
    tool-timings.json        工具开始/结束时间，刷新后恢复计时
    checkpoints.json         每次改文件的工具调用对应哪些快照
    snapshots/               改文件之前的原样副本
  tools/                     用户自己写的工具
  skills.json                启用了哪些外部技能目录、单独禁用了哪些技能
  cache/models-dev.json      models.dev 模型目录缓存，用于自动解析模型图标
```

技能不在数据目录里：全局技能在 `%USERPROFILE%\.agents\skills`，项目技能在会话当前目录的 `.agent/skills`，同名时项目版覆盖全局版。把 `AGENT_HOME` 指到临时目录做测试时，全局技能跟着放到 `<AGENT_HOME>/skills`，不会碰真实用户数据。设置页还会识别 Claude Code、Codex、Gemini CLI、opencode、Cursor 等软件留下的技能目录，用户启用后才参与技能清单；启用状态存在 `skills.json`。

会话历史、文件快照和工具输出可以在「设置 → 数据管理 → 会话数据目录」里单独改到其他磁盘。迁移在重启后端后执行，现有会话会复制过去，旧目录保留。也可以用 `AGENT_SESSIONS` 环境变量直接指定会话目录。

新建对话如果没有指定工作区，会在系统临时目录的 `agent/` 下创建一个独立的临时工作区，避免默认在项目代码旁边操作。切换工作区或删除会话时会清理对应的临时目录。

内置工具在 `server/tools/`；按类别分文件，加一个工具只往这个目录放一个文件。内置技能目录不存在，技能全部来自上面两处用户数据。

## HTTP API

服务端只有 18 个接口：基座和会话各占一部分，设置页与能力页的动作全部收在 `POST /admin` 的 `op` 里。

| 方法 | 地址 | 说明 |
| --- | --- | --- |
| `GET` | `/health` | 服务状态和版本 |
| `GET` | `/session/list` | 全部会话 + 分组，带搜索 |
| `POST` | `/session/create` | 创建会话 |
| `GET` | `/session/read/{sessionId}` | 会话、完整历史、任务清单、待批准、设置 |
| `POST` | `/session/compact/{sessionId}` | 压缩上下文 |
| `POST` | `/session/fork/{sessionId}` | 从现有会话分出一个新分支 |
| `DELETE` | `/session/remove/{sessionId}` | 删除会话 |
| `PATCH` | `/session/rename/{sessionId}` | 改标题 |
| `GET` | `/session/settings/{sessionId}` | 会话级设置快照：思考强度、模型、当前目录 |
| `PATCH` | `/session/settings/{sessionId}` | 改其中任意几项 |
| `POST` | `/session/rollback/{sessionId}` | 给 `messageId` 退对话，给 `toolCallId` 只退那次工具改的文件 |
| `POST` | `/session/rollback/redo/{sessionId}` | 撤销上一次回退 |
| `POST` | `/agent/send/{sessionId}` | 发送消息，过程走 SSE |
| `POST` | `/agent/resume/{sessionId}` | 继续被中断的助手 |
| `POST` | `/agent/stop/{sessionId}` | 停止任务 |
| `POST` | `/agent/decide/{sessionId}` | 处理工具审批：`allow` / `deny` |
| `GET` | `/sse/connect/{sessionId}` | 订阅实时事件 |
| `POST` | `/admin` | 管理总线：`{ op, ...参数 }`，op 见 `server/commands/admin.js` |

`GET /admin?op=model.icon` 是唯一走 GET 的管理动作，因为它要直接当 `<img src>` 用。

错误响应统一是 `{ "error": "说明" }`：填错按 400、找不到按 404、会话在跑按 409、程序问题按 500。
接口清单、SSE 事件表和权限规则见 [`server/README.md`](server/README.md)。

## macOS

本机安装与启动见 [macOS 使用说明](docs/MACOS.md)。

## 跑起来

先准备 `~/.agent/config.json`（供应商、模型和 API 密钥），然后开两个终端：

```sh
cd backend
bun install
bun start
```

服务默认在 `http://127.0.0.1:3000`。再开界面：

```sh
cd web
bun install
bun dev
```

界面在 `http://127.0.0.1:5180`，会把 `/api` 转发到后端。内置扩展随后端启动加载。演示模式可打开 `http://127.0.0.1:5180/?demo`，不连后端。

## 验证

```text
cd backend && bun test         # mock 测试（默认不会打真实模型）
cd web && bun run check        # 前端类型检查
cd web && bun run build        # 前端能构建通过
```

一次真实模型请求（需本机密钥，且会消耗额度）：

```text
cd backend && RUN_REAL=1 bun test tests/real.send.test.js
```

## 仓库约定

改代码前先看 [`AGENTS.md`](AGENTS.md)：
每完成一小步就提交推送、推送前改版本号、改接口要同时改三处契约文档。

## 许可证

Copyright (C) 2026 Kernyr

本项目以 [GNU Affero General Public License v3.0 或更新版本](LICENSE)（`AGPL-3.0-or-later`）开源。通过网络使用本项目时，请遵守 AGPL 第 13 条关于提供对应源代码的要求。
